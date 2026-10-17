import Foundation
import Testing
@testable import Services

struct StravaConnectionAPITests {
    private let flow = StravaConnectionAPI.Flow(url: URL(string: "https://api.ride-on.cc/integrations/strava/authorize")!, requestId: "request", verifier: "verifier", state: "expected")

    @Test func callbackMustMatchOriginStateAndResult() throws {
        try StravaConnectionAPI.validate(callback: URL(string: "https://api.ride-on.cc/integrations/strava/done?state=expected&result=ready")!, flow: flow)
        for value in [
            "https://attacker.test/integrations/strava/done?state=expected&result=ready",
            "http://api.ride-on.cc/integrations/strava/done?state=expected&result=ready",
            "https://api.ride-on.cc/auth/browser/done?state=expected&result=ready",
            "https://api.ride-on.cc/integrations/strava/done?state=other&result=ready",
            "https://api.ride-on.cc/integrations/strava/done?state=expected&result=cancelled",
            "https://api.ride-on.cc/integrations/strava/done?state=expected&state=other&result=ready",
        ] {
            #expect(throws: RideOnAPI.Failure.self) { try StravaConnectionAPI.validate(callback: URL(string: value)!, flow: flow) }
        }
    }

    @Test func cyclingHistoryDecodesTheServerContract() throws {
        let data = Data(#"{"rides":[{"id":"123","name":"Morning ride","sportType":"EBikeRide","startedAt":"2026-10-16T09:00:00Z","distanceKm":42.1,"movingSeconds":6000,"elapsedSeconds":6300,"elevationGainM":400,"url":"https://www.strava.com/activities/123"}],"nextPage":2,"fetchedAt":"2026-10-17T09:00:00.000Z"}"#.utf8)
        let result = try RideOnAPI.decoder.decode(StravaConnectionAPI.History.self, from: data)
        #expect(result.rides.first?.sportType == "EBikeRide")
        #expect(result.rides.first?.movingSeconds == 6000)
        #expect(result.nextPage == 2)
    }
}
