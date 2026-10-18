import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    // NSExtensionContext lives for this one async response and is never mutated elsewhere.
    private struct Reply: @unchecked Sendable { let context: NSExtensionContext }
    func beginRequest(with context: NSExtensionContext) {
        guard let item = context.inputItems.first as? NSExtensionItem,
              let message = item.userInfo?[SFExtensionMessageKey] as? [String: Any],
              let type = message["type"] as? String, ["link", "status", "unlink"].contains(type) else {
            context.completeRequest(returningItems: nil)
            return
        }
        let owner = message["owner"] as? String
        let token = message["token"] as? String
        let apiURL = message["apiURL"] as? String
        let reply = Reply(context: context)
        Task { @MainActor in
            let result: [String: Any]
            do {
                if let owner, let token, !owner.isEmpty, owner.count <= 256, !token.isEmpty, token.count <= 8192 {
                    if type == "link", apiURL != PushStore.api.absoluteString { throw PushStore.Failure("Use the production Ride On extension to enable Apple notifications.") }
                    let previous: PushStore.Link? = try PushStore.read("link")
                    if let previous, previous.owner != owner { throw PushStore.Failure("Turn off notifications for the other Safari account before linking this one.") }
                    if type == "link" || previous != nil {
                        var link = PushStore.Link(owner: owner, token: token)
                        link.enabled = previous?.enabled ?? false
                        try PushStore.write("link", link)
                    }
                } else if type == "link" { throw PushStore.Failure("Sign in before enabling notifications.") }
                if type == "unlink" { try await PushStore.unlink() }
                var status: [String: Any] = try await PushStore.status()
                status["enabled"] = (try PushStore.read("link", as: PushStore.Link.self))?.enabled == true
                result = status
            } catch {
                result = ["error": (error as? PushStore.Failure)?.message ?? "Could not update notifications. Open Ride On and try again."]
            }
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: result]
            reply.context.completeRequest(returningItems: [response])
        }
    }
}
