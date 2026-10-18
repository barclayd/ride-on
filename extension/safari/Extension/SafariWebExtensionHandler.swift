import SafariServices

/// The extension checks in with `{type: "account", owner, token, email, apiURL}` while signed in,
/// and with `{type: "account"}` once signed out. The app shows the account and owns notifications.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
  // NSExtensionContext lives for this one async response and is never mutated elsewhere.
  private struct Reply: @unchecked Sendable { let context: NSExtensionContext }
  func beginRequest(with context: NSExtensionContext) {
    guard let item = context.inputItems.first as? NSExtensionItem,
      let message = item.userInfo?[SFExtensionMessageKey] as? [String: Any],
      message["type"] as? String == "account"
    else {
      context.completeRequest(returningItems: nil)
      return
    }
    let owner = message["owner"] as? String
    let token = message["token"] as? String
    let email = (message["email"] as? String).flatMap { $0.count <= 320 ? $0 : nil }
    let apiURL = message["apiURL"] as? String
    let reply = Reply(context: context)
    Task { @MainActor in
      let result: [String: Any]
      do {
        if let owner, let token, !owner.isEmpty, owner.count <= 256, !token.isEmpty,
          token.count <= 8192
        {
          result = try await Self.signedIn(owner: owner, token: token, email: email, apiURL: apiURL)
        } else {
          // Signed out in Safari: stop alerts and forget the account.
          try? PushStore.remove("sign-out")
          try? await PushStore.unlink()
          result = [
            "status": "off", "enabled": false, "message": "Notifications are off on this device.",
          ]
        }
      } catch {
        result = [
          "error": (error as? PushStore.Failure)?.message
            ?? "Could not check notifications. Open Ride On and try again."
        ]
      }
      let response = NSExtensionItem()
      response.userInfo = [SFExtensionMessageKey: result]
      reply.context.completeRequest(returningItems: [response])
    }
  }

  @MainActor
  private static func signedIn(owner: String, token: String, email: String?, apiURL: String?)
    async throws -> [String: Any]
  {
    guard apiURL == PushStore.api.absoluteString else {
      return [
        "status": "off", "enabled": false,
        "message": "Apple notifications need the production Ride On extension.",
      ]
    }
    if let request: PushStore.SignOut = try PushStore.read("sign-out") {
      try PushStore.remove("sign-out")
      // Only the session the app signed out; a fresh sign-in since then stays.
      if request.owner == owner && request.token == token { return ["signOut": true] }
    }
    let previous: PushStore.Link? = try PushStore.read("link")
    if let previous, previous.owner != owner, previous.enabled {
      throw PushStore.Failure(
        "Ride On on this device is set up for another account. Sign out of it in the Ride On app first."
      )
    }
    var link = PushStore.Link(owner: owner, token: token, email: email)
    link.enabled = previous?.owner == owner && previous?.enabled == true
    try PushStore.write("link", link)
    var status: [String: Any] = try await PushStore.status()
    status["enabled"] = link.enabled
    return status
  }
}
