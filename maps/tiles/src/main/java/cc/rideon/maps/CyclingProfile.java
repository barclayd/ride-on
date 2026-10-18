package cc.rideon.maps;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.FeatureMerge;
import com.onthegomap.planetiler.Planetiler;
import com.onthegomap.planetiler.Profile;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.config.Arguments;
import com.onthegomap.planetiler.geo.GeoUtils;
import com.onthegomap.planetiler.geo.GeometryException;
import com.onthegomap.planetiler.geo.TileCoord;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.WithTags;
import com.onthegomap.planetiler.reader.osm.OsmElement;
import com.onthegomap.planetiler.reader.osm.OsmRelationInfo;
import com.onthegomap.planetiler.util.ZoomFunction;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.locationtech.jts.geom.CoordinateXY;

/**
 * Ride On's cycling overlay: what cycle.travel draws over an OpenStreetMap basemap that the Protomaps basemap doesn't
 * carry. The rules are ported from the prototype's Overpass tools (removed once this replaced them);
 * {@code docs/maps/cycle-travel-style.md} explains each one. Zooms are MapLibre zooms (cycle.travel's zoom minus one).
 *
 * <p>Layers: {@code routes}, {@code route_badges}, {@code paths}, {@code cycle_lanes}, {@code pois}. The schema is
 * in {@code maps/tiles/README.md}.
 */
public class CyclingProfile implements Profile {

  static final List<String> NETWORKS = List.of("", "lcn", "rcn", "ncn", "icn");

  /** A bicycle route relation on one of the four networks. Held in memory for the whole build, so it stays small. */
  record Route(@Override long id, String network, String ref, boolean london, boolean euroVelo)
    implements OsmRelationInfo {

    /** cycle.travel dots only EuroVelo as international: other icn routes (the Avenue Verte) get national dots. */
    int rank() {
      return NETWORKS.indexOf(network.equals("icn") && !euroVelo ? "ncn" : network);
    }

    /**
     * cycle.travel shows regional routes from its z11 (our 10). It holds back London's TfL network (tagged rcn) until
     * you zoom into the city, and its unsigned parts (no C/Q number) plus local routes until street level.
     */
    double minzoom() {
      return switch (network) {
        case "lcn" -> 13;
        case "rcn" -> london ? (ref.isEmpty() ? 13 : 11) : 10;
        default -> 6;
      };
    }

    /** The repeater badge this route shows, or null: only short signed numbers, no "(16)", named trails or bare "C". */
    Badge badge() {
      if (network.equals("lcn") || ref.isEmpty() || ref.equals("C") || !BADGE_REF.matcher(ref).matches()) {
        return null;
      }
      // cycle.travel: EuroVelo/icn in a starred navy square, national in red, regional (London C/Q/CS) in blue.
      boolean eu = network.equals("icn");
      return new Badge(eu ? "eu" : network.equals("ncn") ? "red" : "blue", eu ? ref.replaceFirst("^EV", "") : ref,
        ref.startsWith("EV"));
    }
  }

  record Badge(String badge, String label, boolean ev) {}

  static final Pattern BADGE_REF = Pattern.compile("[A-Z]{0,2}\\d{0,3}");

  static final Set<String> PAVED = Set.of("asphalt", "paved", "concrete", "concrete:plates", "concrete:lanes",
    "paving_stones", "sett", "chipseal", "metal", "wood", "bricks");
  static final Set<String> BIKE = Set.of("yes", "designated", "permissive");
  static final Set<String> OFFROAD = Set.of("path", "footway", "pedestrian", "track");
  /** The paths the Protomaps basemap's roads layer carries as kind=path, which the prototype drew as footpaths. */
  static final Set<String> FOOT = Set.of("footway", "path", "steps", "track");
  static final Set<String> ROADS = Set.of("motorway", "motorway_link", "trunk", "trunk_link", "primary",
    "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential",
    "living_street", "service", "road", "busway");
  /** Rail stations only: no Underground-only, tram or heritage stops. */
  static final Set<String> NOT_RAIL = Set.of("subway", "light_rail", "miniature", "monorail", "funicular", "tram");
  /** POIs cycle.travel marks with an icon at street level (its map key), by OSM key and value. */
  static final Map<String, Map<String, String>> AMENITIES = Map.of(
    "amenity", Map.of("cafe", "cafe", "pub", "pub", "toilets", "toilets", "drinking_water", "drinking_water",
      "bicycle_parking", "bicycle_parking", "parking", "parking"),
    "shop", Map.of("bicycle", "bicycle_shop"),
    "tourism", Map.of("camp_site", "camp_site", "viewpoint", "viewpoint"));
  /** The landmarks cycle.travel names, by OSM key and value. */
  static final Map<String, Set<String>> LANDMARKS = Map.of(
    "tourism", Set.of("attraction", "museum", "zoo", "aquarium", "theme_park"),
    "historic", Set.of("castle", "palace"));
  /** Keys that make a landmark something else: a church or theatre, a square, a street, a park, a shop. */
  static final List<String> NOT_LANDMARKS = List.of("amenity", "place", "highway", "leisure", "shop");
  static final Pattern ELEVATION = Pattern.compile("^\\s*(-?\\d+(?:\\.\\d+)?)");

  @Override
  public List<OsmRelationInfo> preprocessOsmRelation(OsmElement.Relation relation) {
    String network = relation.getString("network", "");
    if (relation.hasTag("route", "bicycle") && NETWORKS.indexOf(network) > 0) {
      String ref = relation.getString("ref", "").trim();
      return List.of(new Route(relation.id(), network, ref,
        relation.getString("cycle_network", "").startsWith("GB:London"),
        relation.hasTag("cycle_network", "EuroVelo") || ref.startsWith("EV")));
    }
    return null;
  }

  @Override
  public void processFeature(SourceFeature feature, FeatureCollector features) {
    if (feature.canBeLine()) {
      routes(feature, features);
      paths(feature, features);
      cycleLanes(feature, features);
    }
    pois(feature, features);
  }

  /**
   * One line per way on a route relation, with the highest network it's on and the lowest zoom any of its routes shows
   * from; then one line per signed route for the badges. Ways are merged per tile in
   * {@link #postProcessLayerFeatures} so dots don't restart at every OSM way join. Ferry crossings are left out, as on
   * cycle.travel: EuroVelo 2 would otherwise dot its way across the North Sea.
   */
  private void routes(SourceFeature way, FeatureCollector features) {
    var memberships = way.relationInfo(Route.class);
    if (memberships.isEmpty() || way.hasTag("route", "ferry")) {
      return;
    }
    int rank = 0;
    double minzoom = Double.MAX_VALUE;
    // A way on two relations with the same network and ref (a route split in parts) gets one badge line.
    Set<Badge> badges = new LinkedHashSet<>();
    for (var membership : memberships) {
      Route route = membership.relation();
      rank = Math.max(rank, route.rank());
      minzoom = Math.min(minzoom, route.minzoom());
      Badge badge = route.badge();
      if (badge != null) {
        badges.add(badge);
      }
    }
    features.line("routes")
      .setAttr("network", NETWORKS.get(rank))
      .setAttr("rank", rank)
      .setAttr("minz", minzoom)
      .setMinZoom((int) Math.floor(minzoom))
      // Short ways would drop out at low zooms before they're merged into the long lines they belong to.
      .setMinPixelSize(0);
    for (Badge badge : badges) {
      features.line("route_badges")
        .setAttr("badge", badge.badge())
        .setAttr("label", badge.label())
        .setAttr("ev", badge.ev())
        .setMinZoom(11)
        .setMinPixelSize(0)
        .setBufferPixels(BADGE_BUFFER);
    }
  }

  static final double BADGE_BUFFER = 8;

  /**
   * cycle.travel's path rule, checked against its tiles over Richmond Park: paved paths you can ride draw red and white
   * ({@code p}), unpaved ones (gravel cycleways, bridleways) brown dashes ({@code u}), and other footpaths, including
   * bridleways closed to bikes, green dashes ({@code foot}). With no surface tag, cycleways and urban path types count
   * as paved, bridleways and tracks as unpaved. Returns null for ways not drawn as paths.
   */
  static String pathClass(WithTags way) {
    String highway = way.getString("highway", "");
    String bicycle = way.getString("bicycle", "");
    if (highway.equals("bridleway") && (bicycle.equals("no") || bicycle.equals("dismount"))) {
      return "foot";
    }
    boolean closed = bicycle.equals("no") || way.hasTag("access", "private", "no");
    boolean rideable =
      highway.equals("cycleway") || highway.equals("bridleway") || (OFFROAD.contains(highway) && BIKE.contains(bicycle));
    if (closed || !rideable) {
      // As the basemap: no pavements or crossings, and private paths only from z15.
      boolean footpath = FOOT.contains(highway) && !way.hasTag("footway", "sidewalk", "crossing") &&
        !way.hasTag("access", "private", "no");
      return footpath ? "foot" : null;
    }
    String surface = way.getString("surface");
    boolean paved = surface != null ? PAVED.contains(surface) :
      highway.equals("track") ? way.hasTag("tracktype", "grade1") : !highway.equals("bridleway");
    return paved ? "p" : "u";
  }

  private void paths(SourceFeature way, FeatureCollector features) {
    String pathClass = pathClass(way);
    boolean tunnel = way.hasTag("tunnel") && !way.hasTag("tunnel", "no");
    if (pathClass == null || tunnel || way.hasTag("area", "yes")) {
      return;
    }
    features.line("paths")
      .setAttr("class", pathClass)
      .setAttr("bridge", way.hasTag("bridge") && !way.hasTag("bridge", "no") ? true : null)
      .setMinZoom(pathClass.equals("foot") ? 14 : 12)
      .setMinPixelSize(0);
  }

  /**
   * Painted cycle lanes on roads ({@code cycleway}, {@code cycleway:both}, {@code cycleway:left},
   * {@code cycleway:right}), as {@code side} left, right or both; {@code bus} marks lanes that are only shared bus
   * lanes. Returns null for roads without one.
   */
  static Map<String, Object> cycleLane(WithTags way) {
    if (!ROADS.contains(way.getString("highway", ""))) {
      return null;
    }
    String left = lane(way, "cycleway:left");
    String right = lane(way, "cycleway:right");
    if (left == null && right == null) {
      return null;
    }
    String side = left != null && right != null ? "both" : left != null ? "left" : "right";
    boolean bus = !"lane".equals(left) && !"lane".equals(right);
    return Map.of("side", side, "bus", bus);
  }

  /** "lane", "bus" or null for one side, falling back to {@code cycleway:both} and then {@code cycleway}. */
  private static String lane(WithTags way, String key) {
    String value = way.getString(key, way.getString("cycleway:both", way.getString("cycleway", "")));
    return switch (value) {
      case "lane", "opposite_lane" -> "lane";
      case "share_busway", "opposite_share_busway" -> "bus";
      default -> null;
    };
  }

  private void cycleLanes(SourceFeature way, FeatureCollector features) {
    var lane = cycleLane(way);
    if (lane != null) {
      features.line("cycle_lanes").putAttrs(lane).setMinZoom(12).setMinPixelSize(0);
    }
  }

  /**
   * Stations and hills, which Protomaps thins out below z14 and cycle.travel doesn't; landmarks, which Protomaps keys
   * differently; and the kinds cycle.travel marks with an icon. Returns the kind, or null.
   */
  static String poiKind(WithTags tags, boolean isNode) {
    boolean named = tags.hasTag("name");
    if (named && isNode && tags.hasTag("natural", "peak", "hill")) {
      return "peak";
    }
    if (named && tags.hasTag("railway", "station") && !NOT_RAIL.contains(tags.getString("station", "")) &&
      !tags.hasTag("usage", "tourism") && !tags.hasTag("railway:preserved") && !tags.hasTag("disused", "yes")) {
      return "station";
    }
    // Before the access check: palaces are private and still landmarks.
    if (named && LANDMARKS.entrySet().stream().anyMatch(e -> e.getValue().contains(tags.getString(e.getKey(), ""))) &&
      NOT_LANDMARKS.stream().noneMatch(tags::hasTag)) {
      return "landmark";
    }
    if (tags.hasTag("access", "private", "no")) {
      return null;
    }
    for (var key : AMENITIES.entrySet()) {
      String kind = key.getValue().get(tags.getString(key.getKey(), ""));
      if (kind != null) {
        return kind;
      }
    }
    return null;
  }

  private void pois(SourceFeature feature, FeatureCollector features) {
    String kind = poiKind(feature, feature.isPoint());
    if (kind == null || !(feature.isPoint() || feature.canBePolygon())) {
      return;
    }
    var poi = (feature.isPoint() ? features.point("pois") : features.pointOnSurface("pois"))
      .setAttr("kind", kind)
      .setAttr("name", feature.getString("name"))
      .setMinZoom(switch (kind) {
        // cycle.travel shows some stations from its z11 (our 10); the style thins them by crowd_5km.
        case "station" -> 10;
        case "peak" -> 12;
        case "landmark" -> 13;
        default -> 14;
      });
    if (kind.equals("peak")) {
      Matcher ele = ELEVATION.matcher(feature.getString("ele", ""));
      poi.setAttr("ele", ele.find() ? (int) Math.round(Double.parseDouble(ele.group(1))) : null);
    }
    if (kind.equals("landmark")) {
      poi.setAttr("icon", landmarkIcon(feature));
      if (!feature.isPoint()) {
        // Below its z16 (our 15) cycle.travel names buildings and bridges, not grounds and squares, so the style
        // picks those out, biggest first.
        try {
          poi.setAttr("area", (int) Math.round(feature.areaMeters()));
        } catch (GeometryException e) {
          // Left without an area, so drawn after the others.
        }
        boolean structure = feature.hasTag("man_made", "bridge") ||
          Stream.of("building", "bridge").anyMatch(k -> feature.hasTag(k) && !feature.hasTag(k, "no"));
        poi.setAttr("structure", structure ? true : null);
      }
    }
    if (ICONS.contains(kind)) {
      // Into the tiles around too, so its neighbours there count it (crowd).
      poi.setBufferPixels(CROWD_BUFFER);
    }
    if (kind.equals("station")) {
      // Into the tiles around too while the style thins them, so its neighbours there count it (crowdedStations).
      poi.setBufferPixelOverrides(ZoomFunction.maxZoom(STATION_CROWD_MAXZOOM, STATION_BUFFER));
    }
  }

  /** The icon cycle.travel marks a landmark with: a castle (castles and palaces), a museum, or a star (the rest). */
  static String landmarkIcon(WithTags tags) {
    if (tags.hasTag("historic", "castle", "palace")) {
      return "castle";
    }
    return tags.hasTag("tourism", "museum") ? "museum" : "attraction";
  }

  /** The POI kinds the style draws as icons. Car parks aren't one: cycle.travel doesn't mark them. */
  static final Set<String> ICONS = Set.of("cafe", "pub", "toilets", "drinking_water", "bicycle_parking",
    "bicycle_shop", "camp_site", "viewpoint");
  /** 1 km at z14 as far north as 66°. */
  static final double CROWD_BUFFER = 256;
  /** Planetiler's default point buffer, which icons keep once counted. */
  static final double POINT_BUFFER = 4;
  /** The last zoom the style thins stations at, by how crowded they are. */
  static final int STATION_CROWD_MAXZOOM = 11;
  /** 5 km at z11 as far north as 61°. */
  static final double STATION_BUFFER = 160;

  @Override
  public Map<String, List<VectorTile.Feature>> postProcessTileFeatures(TileCoord tile,
    Map<String, List<VectorTile.Feature>> layers) {
    var pois = layers.get("pois");
    if (pois == null) {
      return layers;
    }
    Map<String, List<VectorTile.Feature>> result = new HashMap<>(layers);
    double metresPerPixel = metresPerPixel(tile);
    var counted = crowd(pois, metresPerPixel);
    result.put("pois", tile.z() <= STATION_CROWD_MAXZOOM ? crowdedStations(counted, metresPerPixel) : counted);
    return result;
  }

  /** The ground size of one of the tile's 256 pixels, at its middle. */
  static double metresPerPixel(TileCoord tile) {
    return GeoUtils.metersPerPixelAtEquator(tile.z()) * Math.cos(Math.toRadians(tile.getEnvelope().centre().y));
  }

  /**
   * How crowded each icon is: the other icons within 500 m ({@code crowd_500m}) and 1 km ({@code crowd_1km}),
   * counting those just over the tile's edge, which are then dropped. cycle.travel shows a town's POIs a zoom later
   * than a village's and hides city cafés altogether; the style approximates that from these counts.
   */
  static List<VectorTile.Feature> crowd(List<VectorTile.Feature> items, double metresPerPixel) {
    return neighbours(items, ICONS, metresPerPixel, Map.of("crowd_500m", 500.0, "crowd_1km", 1000.0));
  }

  /**
   * How crowded each station is: the other stations within 5 km ({@code crowd_5km}), counting those just over the
   * tile's edge, which are then dropped. At its z11–12 (our 10–11) cycle.travel shows the stations of the country and
   * of a city's edge, not those in it; the style approximates that from this count.
   */
  static List<VectorTile.Feature> crowdedStations(List<VectorTile.Feature> items, double metresPerPixel) {
    return neighbours(items, Set.of("station"), metresPerPixel, Map.of("crowd_5km", 5000.0));
  }

  /** Gives each item of the kinds a count of the others within each distance, under its attribute's name. */
  private static List<VectorTile.Feature> neighbours(List<VectorTile.Feature> items, Set<String> kinds,
    double metresPerPixel, Map<String, Double> within) {
    List<CoordinateXY> counted = items.stream()
      .filter(item -> kinds.contains(item.tags().get("kind")))
      .map(item -> item.geometry().firstCoordinate())
      .toList();
    List<VectorTile.Feature> result = new ArrayList<>();
    for (var item : items) {
      if (!kinds.contains(item.tags().get("kind"))) {
        result.add(item);
        continue;
      }
      var at = item.geometry().firstCoordinate();
      if (at.x < -POINT_BUFFER || at.y < -POINT_BUFFER || at.x > 256 + POINT_BUFFER || at.y > 256 + POINT_BUFFER) {
        continue;
      }
      Map<String, Object> counts = new HashMap<>();
      within.forEach((attr, metres) -> counts.put(attr,
        // Itself included, at 0 m.
        (int) counted.stream().filter(other -> at.distance(other) * metresPerPixel <= metres).count() - 1));
      result.add(item.copyWithExtraAttrs(counts));
    }
    return result;
  }

  @Override
  public List<VectorTile.Feature> postProcessLayerFeatures(String layer, int zoom, List<VectorTile.Feature> items) {
    if (layer.equals("pois")) {
      // Points, with nothing to merge; their crowd counts come from postProcessTileFeatures.
      return items;
    }
    // Planetiler's own tolerances: 0.1px, and 0.0625px at z14 because MapLibre overzooms it.
    double tolerance = zoom >= 14 ? 0.0625 : 0.1;
    double buffer = layer.equals("route_badges") ? BADGE_BUFFER : 4;
    return FeatureMerge.mergeLineStrings(items, 0.5, tolerance, buffer);
  }

  @Override
  public String name() {
    return "Ride On cycling";
  }

  @Override
  public String description() {
    return "Cycle routes, route badges, cycle paths by surface, cycle lanes and cycling POIs for Ride On's cycle map";
  }

  @Override
  public String version() {
    return "1.0.0";
  }

  @Override
  public boolean isOverlay() {
    return true;
  }

  @Override
  public String attribution() {
    return "<a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\">&copy; OpenStreetMap contributors</a>";
  }

  public static void main(String[] args) throws Exception {
    run(Arguments.fromArgsOrConfigFile(args));
  }

  static void run(Arguments args) throws Exception {
    Planetiler.create(args)
      .setProfile(new CyclingProfile())
      // --osm_path=… and --output=… override these.
      .addOsmSource("osm", Path.of("data", "united-kingdom-latest.osm.pbf"))
      .overwriteOutput(Path.of("data", "cycling.pmtiles"))
      .run();
  }
}
