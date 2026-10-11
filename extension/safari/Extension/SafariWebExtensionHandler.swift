import SafariServices

// Safari requires a principal class; Ride On sends no native messages, so it just completes.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        context.completeRequest(returningItems: nil)
    }
}
