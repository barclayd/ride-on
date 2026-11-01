import SwiftUI
import MapKit
import Domain
import SharedUI

/// Where someone is in a ride's detail: the departure, the scrub, the wind, the panel and the map.
/// Rides keeps one per pick, so when an iPhone Duo opens or closes mid-journey and the pushed detail
/// becomes the pane beside Rides (or the other way round), it comes back exactly where it was
/// (DESIGN-SYSTEM.md §5, iPhone Duo). Folding only changes how much room the ride gets.
@MainActor @Observable
public final class RideDetailState {
    var selection: Date
    var addedToCalendar: Date?
    var elevation: [RideDetail.ElevationPoint]
    var detent: PanelDetent = .medium
    /// The route coloured by the wind's effect, with its key.
    var showsWind = false
    /// Where the finger is on Along the Route's profile, in km.
    var scrubKm: Double?
    /// The board the ride was opened from, kept while a refresh drops its details.
    var savedBoard: RideBoard
    #if os(iOS)
    var camera: CycleMap.Camera
    #else
    var position: MapCameraPosition
    #endif
    /// How far the panel is scrolled. Only read when a panel appears, so not observed.
    @ObservationIgnored var scrollY: CGFloat = 0

    public init(board: RideBoard, pick: RideBoard.Pick) {
        savedBoard = board
        // The fixture board carries no details; it keeps the sample.
        let detail = board.details[pick.id] ?? .sample(for: pick, on: board)
        elevation = detail.elevation
        selection = pick.start
        let frame = Self.frame(of: pick.route.coordinates)
        #if os(iOS)
        camera = frame.map { .rect($0) } ?? .automatic
        #else
        position = frame.map { .rect($0) } ?? .automatic
        #endif
    }

    /// The route's bounding box with a margin, or nil without a line to frame.
    static func frame(of coordinates: [Coordinate]) -> MKMapRect? {
        guard coordinates.count > 1 else { return nil }
        let box = coordinates.reduce(MKMapRect.null) { box, coordinate in
            let point = MKMapPoint(CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude))
            return box.union(MKMapRect(origin: point, size: MKMapSize(width: 0, height: 0)))
        }
        return box.insetBy(dx: -box.width * 0.08, dy: -box.height * 0.08)
    }

    /// Frames the whole route again.
    func fit(_ route: RideBoard.RouteSummary) {
        let frame = Self.frame(of: route.coordinates)
        #if os(iOS)
        camera = frame.map { .rect($0) } ?? .automatic
        #else
        position = frame.map { .rect($0) } ?? .automatic
        #endif
    }
}

/// Rides' detail states, one per pick, made the first time a pick is opened.
@MainActor
final class RideDetailStates {
    private var states: [RideBoard.Pick.ID: RideDetailState] = [:]

    func state(for pick: RideBoard.Pick, on board: RideBoard) -> RideDetailState {
        if let state = states[pick.id] { return state }
        let state = RideDetailState(board: board, pick: pick)
        states[pick.id] = state
        return state
    }
}
