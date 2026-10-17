-- Reclassify v2's automatic 50% matches without retaining new activity content.
-- Candidates are already sorted by coverage, then route ID. Keep rider choices.
WITH evidence AS (
  SELECT owner_id,activity_id,
    json_extract(match_json,'$.candidates[0].routeId') AS route_id,
    json_extract(match_json,'$.candidates[0].coverageFraction') AS coverage,
    json_extract(match_json,'$.candidates[1].coverageFraction') AS alternative,
    json_extract(match_json,'$.candidates[0].direction') AS direction,
    json_extract(match_json,'$.assessmentComplete') AS complete
  FROM strava_activity_cache
  WHERE json_extract(match_json,'$.matcherVersion')='strava-route-coverage-v2'
), classified AS (
  SELECT *,CASE
    WHEN COALESCE(complete,0)=0 THEN 'incomplete_geometry'
    WHEN alternative>=0.9 OR coverage-alternative<0.05 THEN 'multiple_routes'
    WHEN direction='mixed' THEN 'mixed_direction'
    WHEN coverage<0.9 THEN 'partial_route'
    ELSE NULL END AS reason
  FROM evidence
), decisions AS (
  SELECT *,CASE
    WHEN coverage>=0.9 AND reason IS NULL THEN 'matched'
    WHEN coverage>=0.5 THEN 'suggested'
    WHEN complete=1 THEN 'unmatched'
    ELSE 'unavailable' END AS status
  FROM classified
)
UPDATE strava_activity_cache AS a SET
  match_json=json_set(a.match_json,
    '$.matcherVersion','strava-route-coverage-v3',
    '$.status',d.status,'$.reason',d.reason,
    '$.primaryRouteId',CASE WHEN d.status='matched' THEN d.route_id ELSE NULL END),
  primary_route_id=CASE WHEN a.decision!='automatic' THEN a.primary_route_id
    WHEN d.status='matched' THEN d.route_id ELSE NULL END,
  version=a.version+CASE WHEN a.decision='automatic' THEN 1 ELSE 0 END
FROM decisions d WHERE a.owner_id=d.owner_id AND a.activity_id=d.activity_id;

-- Only proven clear automatic matches continue to count. Missing evidence is
-- re-fetched by the normal bounded dispatcher; the minimal date is preserved.
UPDATE strava_ride_history AS h SET
  primary_route_id=(SELECT a.primary_route_id FROM strava_activity_cache a
    WHERE a.owner_id=h.owner_id AND a.activity_id=h.activity_id AND a.generation=h.generation
    AND json_extract(a.match_json,'$.matcherVersion')='strava-route-coverage-v3'),
  version=MAX(h.version+1,COALESCE((SELECT a.version FROM strava_activity_cache a
    WHERE a.owner_id=h.owner_id AND a.activity_id=h.activity_id),0)),
  verified_at=0
WHERE h.decision='automatic';

-- Request reassessment of existing imports, including those outside 90 days.
UPDATE strava_activity_cache SET fetched_at=0
WHERE decision='automatic' AND json_extract(match_json,'$.matcherVersion')!='strava-route-coverage-v3';
UPDATE strava_import_sessions SET last_scan_at=0;
