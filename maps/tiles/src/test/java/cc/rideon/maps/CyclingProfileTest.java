package cc.rideon.maps;

import static com.onthegomap.planetiler.TestUtils.newLineString;
import static com.onthegomap.planetiler.TestUtils.newPoint;
import static com.onthegomap.planetiler.TestUtils.rectangle;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.TestUtils;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.config.Arguments;
import com.onthegomap.planetiler.geo.GeoUtils;
import com.onthegomap.planetiler.geo.TileCoord;
import com.onthegomap.planetiler.mbtiles.Mbtiles;
import com.onthegomap.planetiler.reader.SimpleFeature;
import com.onthegomap.planetiler.reader.WithTags;
import com.onthegomap.planetiler.reader.osm.OsmElement;
import com.onthegomap.planetiler.reader.osm.OsmReader;
import com.onthegomap.planetiler.reader.osm.OsmRelationInfo;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.locationtech.jts.geom.LineString;
import org.locationtech.jts.geom.Point;

class CyclingProfileTest {

  private final CyclingProfile profile = new CyclingProfile();

  /** Tags from "k=v k=v" pairs. */
  private static Map<String, Object> tags(String pairs) {
    Map<String, Object> tags = new HashMap<>();
    for (String pair : pairs.isBlank() ? new String[0] : pairs.trim().split("\\s+")) {
      String[] kv = pair.split("=", 2);
      tags.put(kv[0], kv[1]);
    }
    return tags;
  }

  private CyclingProfile.Route relation(String pairs) {
    var result = profile.preprocessOsmRelation(new OsmElement.Relation(1, tags("type=route route=bicycle " + pairs),
      List.of(new OsmElement.Relation.Member(OsmElement.Type.WAY, 2, ""))));
    return result == null ? null : (CyclingProfile.Route) result.getFirst();
  }

  private List<FeatureCollector.Feature> way(String pairs, CyclingProfile.Route... routes) {
    List<OsmReader.RelationMember<OsmRelationInfo>> members = new java.util.ArrayList<>();
    for (var route : routes) {
      members.add(new OsmReader.RelationMember<>("", route));
    }
    return TestUtils.processSourceFeature(SimpleFeature.createFakeOsmFeature(newLineString(0, 51, 0.01, 51.01),
      tags(pairs), "osm", null, 2, members), profile);
  }

  private static List<FeatureCollector.Feature> layer(List<FeatureCollector.Feature> features, String layer) {
    return features.stream().filter(f -> f.getLayer().equals(layer)).toList();
  }

  @Test
  void keepsBicycleRoutesOnTheFourNetworks() {
    assertEquals(new CyclingProfile.Route(1, "ncn", "4", false, false), relation("network=ncn ref=4"));
    assertEquals(new CyclingProfile.Route(1, "rcn", "C9", true, false),
      relation("network=rcn ref=C9 cycle_network=GB:London:Cycleways"));
    assertEquals(new CyclingProfile.Route(1, "icn", "EV2", false, true), relation("network=icn ref=EV2"));
    assertEquals(new CyclingProfile.Route(1, "icn", "", false, true), relation("network=icn cycle_network=EuroVelo"));
    assertNull(relation("network=mtb ref=4"));
    assertNull(relation("network=rcn state=proposed"));
    assertNull(relation("network=lcn ref=C state=construction"));
    assertNull(relation(""));
    assertNull(profile.preprocessOsmRelation(new OsmElement.Relation(1, tags("type=route route=hiking network=ncn"),
      List.of())));
  }

  @ParameterizedTest
  @CsvSource({
    "network=icn ref=EV2, 6",
    "network=ncn ref=4, 6",
    "network=rcn ref=7, 10",
    "network=rcn ref=C9 cycle_network=GB:London:Cycleways, 12",
    "network=rcn cycle_network=GB:London, 13",
    "network=lcn ref=LCN, 13",
  })
  void routesShowFromTheirNetworksZoom(String pairs, double minzoom) {
    var routes = layer(way("highway=residential", relation(pairs)), "routes");
    assertEquals(1, routes.size());
    assertEquals(minzoom, routes.getFirst().getAttrsAtZoom(14).get("minz"));
    assertEquals((int) Math.floor(minzoom), routes.getFirst().getMinZoom());
  }

  @Test
  void aWayOnSeveralRoutesTakesTheHighestNetworkAndLowestZoom() {
    var routes = layer(way("highway=residential", relation("network=lcn"), relation("network=ncn ref=4"),
      relation("network=rcn ref=C9 cycle_network=GB:London")), "routes");
    assertEquals(1, routes.size());
    assertEquals(Map.of("network", "ncn", "rank", 3, "minz", 6.0), routes.getFirst().getAttrsAtZoom(14));
  }

  @ParameterizedTest
  @CsvSource({
    "network=icn ref=EV2, icn",
    "network=icn cycle_network=EuroVelo, icn",
    "network=icn ref=AV, ncn",
  })
  void onlyEuroVeloRoutesAreDottedAsInternational(String pairs, String network) {
    var routes = layer(way("highway=residential", relation(pairs)), "routes");
    assertEquals(network, routes.getFirst().getAttrsAtZoom(14).get("network"));
  }

  @Test
  void ferryCrossingsOnARouteAreLeftOut() {
    var features = way("route=ferry", relation("network=icn ref=EV2"), relation("network=ncn ref=51"));
    assertEquals(List.of(), layer(features, "routes"));
    assertEquals(List.of(), layer(features, "route_badges"));
  }

  @ParameterizedTest
  @CsvSource({
    "network=icn ref=EV2, eu, 2, true, 11",
    "network=icn ref=12, eu, 12, false, 11",
    "network=ncn ref=4, red, 4, false, 11",
    "network=rcn ref=CS7, blue, CS7, false, 11",
    "network=rcn ref=Q1, blue, Q1, false, 11",
    // London's badges wait for its dots.
    "network=rcn ref=C9 cycle_network=GB:London:Cycleways, blue, C9, false, 12",
  })
  void signedRoutesGetABadge(String pairs, String badge, String label, boolean ev, int minzoom) {
    var badges = layer(way("highway=residential", relation(pairs)), "route_badges");
    assertEquals(1, badges.size());
    assertEquals(Map.of("badge", badge, "label", label, "ev", ev), badges.getFirst().getAttrsAtZoom(14));
    assertEquals(minzoom, badges.getFirst().getMinZoom());
  }

  @ParameterizedTest
  @CsvSource({
    "network=lcn ref=7",
    "network=ncn",
    "network=rcn ref=C",
    "network=ncn ref=(16)",
    "network=rcn ref=Avon_Cycleway",
    "network=ncn ref=ABC1",
  })
  void unsignedRoutesGetNoBadge(String pairs) {
    assertEquals(List.of(), layer(way("highway=residential", relation(pairs)), "route_badges"));
  }

  @Test
  void aRouteSplitIntoPartsGetsOneBadgePerWay() {
    var badges = layer(way("highway=residential", relation("network=ncn ref=4"), relation("network=ncn ref=4"),
      relation("network=icn ref=EV2")), "route_badges");
    assertEquals(List.of("4", "2"), badges.stream().map(f -> f.getAttrsAtZoom(14).get("label")).toList());
  }

  @ParameterizedTest
  @CsvSource(nullValues = "null", value = {
    // Paved and rideable.
    "highway=cycleway, p",
    "highway=cycleway surface=asphalt, p",
    "highway=path bicycle=designated, p",
    "highway=footway bicycle=yes surface=paving_stones, p",
    "highway=pedestrian bicycle=permissive, p",
    "highway=track bicycle=yes tracktype=grade1, p",
    "highway=footway footway=sidewalk bicycle=designated, p",
    // Private drives and estate roads open to bikes, as cycle.travel draws them around Wix and Domsey Chase.
    "highway=service access=private bicycle=yes, p",
    "highway=service access=no bicycle=permissive, p",
    "highway=service access=private bicycle=yes surface=gravel, u",
    "highway=track access=private bicycle=yes, u",
    "highway=cycleway access=private bicycle=designated, p",
    // Unpaved and rideable.
    "highway=cycleway surface=gravel, u",
    "highway=bridleway, u",
    "highway=bridleway surface=asphalt, p",
    "highway=track bicycle=designated, u",
    "highway=path bicycle=designated surface=compacted, u",
    // Footpaths.
    "highway=footway, foot",
    "highway=path, foot",
    "highway=steps, foot",
    "highway=track, foot",
    "highway=bridleway bicycle=no, foot",
    "highway=bridleway bicycle=dismount, foot",
    "highway=path bicycle=no, foot",
    // Not drawn: pavements, crossings, private paths, roads, closed cycleways.
    "highway=footway footway=sidewalk, null",
    "highway=footway footway=crossing, null",
    "highway=footway access=private, null",
    "highway=cycleway access=no, null",
    "highway=cycleway bicycle=no, null",
    "highway=pedestrian, null",
    "highway=residential, null",
    "highway=service, null",
    "highway=service bicycle=yes, null",
    "highway=service access=private, null",
    "building=yes, null",
  })
  void pathClass(String pairs, String expected) {
    assertEquals(expected, CyclingProfile.pathClass(WithTags.from(tags(pairs))));
  }

  @Test
  void pathsCarryBridgesAndSkipTunnelsAndAreas() {
    var bridge = layer(way("highway=cycleway bridge=yes"), "paths").getFirst();
    assertEquals(Map.of("class", "p", "bridge", true), bridge.getAttrsAtZoom(14));
    assertEquals(11, bridge.getMinZoom());
    assertEquals(Map.of("class", "foot"), layer(way("highway=footway bridge=no"), "paths").getFirst()
      .getAttrsAtZoom(14));
    assertEquals(14, layer(way("highway=footway"), "paths").getFirst().getMinZoom());
    assertEquals(List.of(), layer(way("highway=cycleway tunnel=yes"), "paths"));
    assertEquals(1, layer(way("highway=cycleway tunnel=no"), "paths").size());
    assertEquals(List.of(), layer(way("highway=pedestrian bicycle=yes area=yes"), "paths"));
  }

  @ParameterizedTest
  @CsvSource(nullValues = "null", value = {
    "highway=primary cycleway=lane, both, false",
    "highway=primary cycleway:both=lane, both, false",
    "highway=primary cycleway:left=lane, left, false",
    "highway=residential cycleway:right=opposite_lane, right, false",
    "highway=primary cycleway:left=lane cycleway:right=share_busway, both, false",
    "highway=primary cycleway=share_busway, both, true",
    "highway=primary cycleway=track, null, null",
    "highway=primary cycleway=no, null, null",
    "highway=cycleway cycleway=lane, null, null",
    "highway=primary cycleway=lane cycleway:right=no, left, false",
  })
  void cycleLanes(String pairs, String side, Boolean bus) {
    var lane = CyclingProfile.cycleLane(WithTags.from(tags(pairs)));
    assertEquals(side == null ? null : Map.of("side", side, "bus", bus), lane);
  }

  @ParameterizedTest
  @CsvSource(nullValues = "null", value = {
    "highway=unclassified, minor",
    "highway=residential, minor",
    "highway=living_street, minor",
    "highway=residential access=private, null",
    "highway=unclassified tunnel=yes, null",
    "highway=unclassified tunnel=no, minor",
    "highway=living_street area=yes, null",
    "highway=tertiary, null",
    "highway=service, null",
    "railway=rail, rail",
    "railway=rail usage=main, rail",
    "railway=rail service=siding, null",
    "railway=rail usage=industrial, null",
    "railway=rail tunnel=yes, null",
    "railway=subway, null",
  })
  void lowRoad(String pairs, String expected) {
    assertEquals(expected, CyclingProfile.lowRoad(WithTags.from(tags(pairs))));
  }

  @Test
  void lowRoadsFillTheZoomsBelowTheBasemaps() {
    var lane = layer(way("highway=unclassified"), "low_roads").getFirst();
    assertEquals(Map.of("kind", "minor", "kind_detail", "unclassified"), lane.getAttrsAtZoom(10));
    assertEquals(10, lane.getMinZoom());
    assertEquals(11, lane.getMaxZoom());
    var rail = layer(way("railway=rail"), "low_roads").getFirst();
    assertEquals(Map.of("kind", "rail"), rail.getAttrsAtZoom(10));
    assertEquals(8, rail.getMinZoom());
    assertEquals(10, rail.getMaxZoom());
  }

  @Test
  void cycleLanesShowFromZoom12() {
    var lanes = layer(way("highway=primary cycleway:left=lane"), "cycle_lanes");
    assertEquals(Map.of("side", "left", "bus", false), lanes.getFirst().getAttrsAtZoom(14));
    assertEquals(12, lanes.getFirst().getMinZoom());
  }

  @ParameterizedTest
  @CsvSource(nullValues = "null", value = {
    "railway=station name=Richmond, true, station",
    "railway=station name=Richmond, false, station",
    "railway=station, true, null",
    "railway=station name=Bank station=subway, true, null",
    "railway=station name=Kew usage=tourism, true, null",
    "railway=station name=Kew railway:preserved=yes, true, null",
    "natural=peak name=Leith_Hill, true, peak",
    "natural=hill name=Box_Hill, true, peak",
    "natural=peak name=Leith_Hill, false, null",
    "natural=peak, true, null",
    "amenity=cafe, true, cafe",
    "amenity=pub name=The_Ship, false, pub",
    "amenity=toilets access=private, true, null",
    "amenity=drinking_water, true, drinking_water",
    "amenity=bicycle_parking, true, bicycle_parking",
    "amenity=parking, false, parking",
    "shop=bicycle, true, bicycle_shop",
    "tourism=camp_site, false, camp_site",
    "tourism=viewpoint, true, viewpoint",
    "amenity=bench, true, null",
    "tourism=attraction name=London_Eye, false, landmark",
    "tourism=museum name=Science_Museum, true, landmark",
    "historic=palace name=Lambeth_Palace access=private, false, landmark",
    "tourism=attraction, false, null",
    "tourism=gallery name=Tate_Modern, false, null",
    "tourism=attraction name=Westminster_Abbey amenity=place_of_worship, false, null",
    "tourism=attraction name=Trafalgar_Square place=square, false, null",
    "tourism=attraction name=Piccadilly_Circus highway=pedestrian, false, null",
    "tourism=attraction name=Hyde_Park leisure=park, false, null",
    "tourism=attraction name=Harrods shop=department_store, false, null",
  })
  void poiKind(String pairs, boolean isNode, String expected) {
    assertEquals(expected, CyclingProfile.poiKind(WithTags.from(tags(pairs)), isNode));
  }

  @Test
  void poisArePointsWithKindNameAndPeakHeights() {
    var peak = TestUtils.processSourceFeature(SimpleFeature.createFakeOsmFeature(newPoint(-0.37, 51.17),
      tags("natural=peak name=Leith_Hill ele=294.5m"), "osm", null, 1, List.of()), profile);
    assertEquals(1, peak.size());
    assertEquals(Map.of("kind", "peak", "name", "Leith_Hill", "ele", 295), peak.getFirst().getAttrsAtZoom(14));
    assertEquals(12, peak.getFirst().getMinZoom());

    var station = TestUtils.processSourceFeature(SimpleFeature.createFakeOsmFeature(newPoint(1.25, 51.94),
      tags("railway=station name=Dovercourt"), "osm", null, 1, List.of()), profile);
    assertEquals(10, station.getFirst().getMinZoom());

    var cafe = TestUtils.processSourceFeature(SimpleFeature.createFakeOsmFeature(rectangle(0, 0.001),
      tags("amenity=cafe name=Pembroke_Lodge"), "osm", null, 1, List.of()), profile);
    assertEquals(1, cafe.size());
    assertEquals("pois", cafe.getFirst().getLayer());
    assertTrue(cafe.getFirst().getGeometry() instanceof Point);
    assertEquals(14, cafe.getFirst().getMinZoom());

    var unnamed = TestUtils.processSourceFeature(SimpleFeature.createFakeOsmFeature(newPoint(0, 0),
      tags("amenity=toilets"), "osm", null, 1, List.of()), profile);
    assertEquals(Map.of("kind", "toilets"), unnamed.getFirst().getAttrsAtZoom(14));
  }

  @Test
  void landmarksCarryTheirIconAndAreasTheirSizeAndWhetherTheyAreAStructure() {
    // 0.002° by 0.001° at 51.5° N: 138.6 m by 111.3 m.
    var palace = TestUtils.processSourceFeature(SimpleFeature.createFakeOsmFeature(
      rectangle(-0.142, 51.501, -0.140, 51.502), tags("tourism=attraction historic=castle building=palace " +
        "name=Buckingham_Palace"), "osm", null, 1, List.of()), profile);
    assertEquals(1, palace.size());
    assertTrue(palace.getFirst().getGeometry() instanceof Point);
    assertEquals(13, palace.getFirst().getMinZoom());
    var attrs = palace.getFirst().getAttrsAtZoom(13);
    assertEquals("landmark", attrs.get("kind"));
    assertEquals("castle", attrs.get("icon"));
    assertEquals(true, attrs.get("structure"));
    assertEquals(15_420, (int) attrs.get("area"), 100);

    var bridge = TestUtils.processSourceFeature(SimpleFeature.createFakeOsmFeature(
      rectangle(-0.123, 51.500, -0.121, 51.501), tags("tourism=attraction man_made=bridge name=Westminster_Bridge"),
      "osm", null, 1, List.of()), profile);
    assertEquals(true, bridge.getFirst().getAttrsAtZoom(13).get("structure"));
    assertEquals("attraction", bridge.getFirst().getAttrsAtZoom(13).get("icon"));

    var parade = TestUtils.processSourceFeature(SimpleFeature.createFakeOsmFeature(
      rectangle(-0.129, 51.504, -0.127, 51.505), tags("tourism=attraction landuse=military name=Horse_Guards_Parade"),
      "osm", null, 1, List.of()), profile);
    assertNull(parade.getFirst().getAttrsAtZoom(13).get("structure"));

    var eye = TestUtils.processSourceFeature(SimpleFeature.createFakeOsmFeature(newPoint(-0.1196, 51.5033),
      tags("tourism=attraction name=London_Eye"), "osm", null, 1, List.of()), profile);
    assertEquals(Map.of("kind", "landmark", "name", "London_Eye", "icon", "attraction"),
      eye.getFirst().getAttrsAtZoom(13));
  }

  @ParameterizedTest
  @CsvSource({
    "tourism=attraction historic=castle, castle",
    "historic=palace, castle",
    "tourism=museum historic=castle, castle",
    "tourism=museum man_made=windmill, museum",
    "tourism=zoo, attraction",
    "tourism=attraction attraction=big_wheel, attraction",
  })
  void landmarkIcons(String tagString, String icon) {
    assertEquals(icon, CyclingProfile.landmarkIcon(WithTags.from(tags(tagString))));
  }

  @Test
  void iconsReachIntoTheTilesAroundSoTheirNeighboursThereCountThem() {
    var toilets = TestUtils.processSourceFeature(SimpleFeature.createFakeOsmFeature(newPoint(0, 0),
      tags("amenity=toilets"), "osm", null, 1, List.of()), profile);
    assertEquals(CyclingProfile.CROWD_BUFFER, toilets.getFirst().getBufferPixelsAtZoom(14));
    // 1 km in z14 pixels at Lerwick, 60.2° N.
    assertTrue(CyclingProfile.CROWD_BUFFER > 1000 / CyclingProfile.metresPerPixel(TileCoord.aroundLngLat(-1.1, 60.2,
      14)));
    var station = TestUtils.processSourceFeature(SimpleFeature.createFakeOsmFeature(newPoint(0, 0),
      tags("railway=station name=Richmond"), "osm", null, 1, List.of()), profile);
    assertEquals(CyclingProfile.POINT_BUFFER, station.getFirst().getBufferPixelsAtZoom(14));
    // While the style thins them, stations reach out to count theirs: 5 km in z11 pixels at Thurso, 58.6° N.
    assertEquals(CyclingProfile.STATION_BUFFER, station.getFirst().getBufferPixelsAtZoom(11));
    assertEquals(CyclingProfile.POINT_BUFFER, station.getFirst().getBufferPixelsAtZoom(12));
    assertTrue(CyclingProfile.STATION_BUFFER > 5000 / CyclingProfile.metresPerPixel(TileCoord.aroundLngLat(-3.5, 58.6,
      11)));
  }

  @Test
  void metresPerPixelShrinkWithLatitude() {
    assertEquals(5.95, CyclingProfile.metresPerPixel(TileCoord.aroundLngLat(-0.13, 51.5, 14)), 0.01);
    assertEquals(4.75, CyclingProfile.metresPerPixel(TileCoord.aroundLngLat(-1.1, 60.2, 14)), 0.01);
  }

  private static VectorTile.Feature poi(String kind, double x, double y) {
    return new VectorTile.Feature("pois", 1, VectorTile.encodeGeometry(newPoint(x, y)), Map.of("kind", kind));
  }

  @Test
  void countsEachIconsNeighboursWithin500mAnd1kmThenDropsThoseOverTheEdge() {
    // 5 m a pixel: 500 m is 100 px, 1 km 200 px.
    var crowd = CyclingProfile.crowd(List.of(
      poi("cafe", 128, 128),
      poi("station", 130, 130),
      // 400 m south of the café.
      poi("pub", 128, 208),
      // 800 m south of the café, in the tile below.
      poi("toilets", 128, 288),
      // 1.39 km west of the café, in the tile to the left.
      poi("bicycle_parking", -150, 128),
      // Car parks aren't icons, so don't count.
      poi("parking", 120, 128),
      // Just over the edge, inside planetiler's usual point buffer.
      poi("viewpoint", 258, 128)
    ), 5);
    assertEquals(List.of(
      Map.of("kind", "cafe", "crowd_500m", 1, "crowd_1km", 3),
      Map.of("kind", "station"),
      Map.of("kind", "pub", "crowd_500m", 2, "crowd_1km", 3),
      Map.of("kind", "parking"),
      Map.of("kind", "viewpoint", "crowd_500m", 0, "crowd_1km", 2)
    ), crowd.stream().map(VectorTile.Feature::tags).toList());
  }

  @Test
  void countsEachStationsNeighboursWithin5kmThenDropsThoseOverTheEdge() {
    // 25 m a pixel: 5 km is 200 px.
    var crowd = CyclingProfile.crowdedStations(List.of(
      poi("station", 128, 128),
      // 4.5 km east, in the tile to the right.
      poi("station", 308, 128),
      // 5.5 km south, in the tile below.
      poi("station", 128, 348),
      // Cafés aren't stations, so don't count.
      poi("cafe", 130, 130),
      poi("station", 60, 60)
    ), 25);
    assertEquals(List.of(
      Map.of("kind", "station", "crowd_5km", 2),
      Map.of("kind", "cafe"),
      Map.of("kind", "station", "crowd_5km", 1)
    ), crowd.stream().map(VectorTile.Feature::tags).toList());
  }

  @Test
  void mergesConnectedLinesSoDotsDontRestartAtEveryWay() throws Exception {
    Map<String, Object> attrs = Map.of("network", "ncn", "rank", 3, "minz", 6.0);
    var first = new VectorTile.Feature("routes", 1, VectorTile.encodeGeometry(newLineString(0, 0, 10, 0)), attrs);
    var second = new VectorTile.Feature("routes", 2, VectorTile.encodeGeometry(newLineString(10, 0, 20, 0)), attrs);
    var merged = new VectorTile.Feature("routes", 0, VectorTile.encodeGeometry(newLineString(0, 0, 20, 0)), attrs);
    assertEquals(List.of(merged), profile.postProcessLayerFeatures("routes", 14, List.of(first, second)));
  }

  @Test
  void monaco(@TempDir Path tmpDir) throws Exception {
    Path output = tmpDir.resolve("cycling.mbtiles");
    CyclingProfile.run(Arguments.of(
      "osm_path", TestUtils.extractPathToResource(tmpDir, "monaco-latest.osm.pbf"),
      // Not tmpDir itself: planetiler empties its tmpdir first.
      "tmpdir", tmpDir.resolve("planetiler").toString(),
      "output", output.toString()
    ));
    try (Mbtiles mbtiles = Mbtiles.newReadOnlyDatabase(output)) {
      var metadata = mbtiles.metadataTable().getAll();
      assertEquals("Ride On cycling", metadata.get("name"));
      TestUtils.assertContains("openstreetmap.org/copyright", metadata.get("attribution"));
      // EuroVelo 8 runs along the coast: an icn line from z6, and a starred EV badge from z11.
      TestUtils.assertMinFeatureCount(mbtiles, "routes", 14, Map.of("network", "icn"),
        GeoUtils.WORLD_LAT_LON_BOUNDS, 0, LineString.class);
      TestUtils.assertMinFeatureCount(mbtiles, "routes", 6, Map.of("network", "icn"),
        GeoUtils.WORLD_LAT_LON_BOUNDS, 0, LineString.class);
      TestUtils.assertMinFeatureCount(mbtiles, "route_badges", 14, Map.of("badge", "eu", "label", "8", "ev", true),
        GeoUtils.WORLD_LAT_LON_BOUNDS, 0, LineString.class);
      TestUtils.assertNumFeatures(mbtiles, "route_badges", 10, Map.of(), GeoUtils.WORLD_LAT_LON_BOUNDS, 0,
        LineString.class);
      TestUtils.assertMinFeatureCount(mbtiles, "paths", 14, Map.of(), GeoUtils.WORLD_LAT_LON_BOUNDS, 0,
        LineString.class);
      TestUtils.assertMinFeatureCount(mbtiles, "pois", 14, Map.of("kind", "station"),
        GeoUtils.WORLD_LAT_LON_BOUNDS, 0, Point.class);
      TestUtils.assertTileDuplicates(mbtiles, 0);
    }
  }
}
