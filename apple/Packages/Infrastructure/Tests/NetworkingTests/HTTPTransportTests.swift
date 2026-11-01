import Foundation
import Testing
import Networking

struct HTTPTransportTests {
    @Test func configuredTransportPreservesRequestAndResponse() async throws {
        let body = Data("{\"expectedVersion\":7}".utf8)
        let transport = HTTPTransport(baseURL: URL(string: "https://synthetic.ride-on.test")!) { request in
            #expect(request.url?.host == "synthetic.ride-on.test")
            #expect(request.url?.path == "/route-selection")
            #expect(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems == [URLQueryItem(name: "cursor", value: "a&b")])
            #expect(request.httpMethod == "PUT")
            #expect(request.httpBody == body)
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic")
            return (body, HTTPURLResponse(url: request.url!, statusCode: 409, httpVersion: nil, headerFields: ["Retry-After": "3"])!)
        }
        let (result, response) = try await transport.data("/route-selection", method: "PUT", query: [URLQueryItem(name: "cursor", value: "a&b")], headers: ["Authorization": "Bearer synthetic"], body: body)
        #expect(result == body)
        #expect((response as? HTTPURLResponse)?.statusCode == 409)
        #expect((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Retry-After") == "3")
    }

    @Test func cancellationDoesNotPublishALateResponse() async throws {
        let transport = HTTPTransport(baseURL: URL(string: "https://synthetic.ride-on.test")!) { request in
            withUnsafeCurrentTask { $0?.cancel() }
            return (Data(), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let task = Task { try await transport.data("/users/me") }
        do {
            _ = try await task.value
            Issue.record("Expected cancellation")
        } catch is CancellationError { }
    }
}
