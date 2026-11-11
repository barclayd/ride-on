import UIKit
import SwiftUI
import UniformTypeIdentifiers
import RouteFiles
import RouteImportUI

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        let loader = SharedRouteLoader(providers: providers)
        let host = UIHostingController(rootView: RouteImportSheet(load: { try await loader.load() }) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        })
        addChild(host)
        view.addSubview(host.view)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        host.didMove(toParent: self)
    }
}

/// Item providers are only used to initiate a single asynchronous read. The temporary
/// file is read inside its callback, before iOS revokes access to that representation.
private final class SharedRouteLoader: @unchecked Sendable {
    let providers: [NSItemProvider]
    init(providers: [NSItemProvider]) { self.providers = providers }

    func load() async throws -> RouteFile {
        guard providers.count == 1, let provider = providers.first else { throw RouteFile.Failure.unsupported }
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            return try await withCheckedThrowingContinuation { continuation in
                provider.loadObject(ofClass: URL.self) { url, error in
                    do {
                        if let error { throw error }
                        guard let url else { throw RouteFile.Failure.unsupported }
                        continuation.resume(returning: try RouteFile.read(url))
                    } catch { continuation.resume(throwing: error) }
                }
            }
        }
        // Some hosts advertise their own GPX UTI or just public.data. Validate the
        // actual filename and contents, not the provider's UTI alone.
        let types = provider.registeredTypeIdentifiers
        guard let type = types.first(where: { $0.lowercased().contains("gpx") || $0.lowercased().contains("fit") })
                ?? types.first(where: { UTType($0)?.conforms(to: .data) == true }) else { throw RouteFile.Failure.unsupported }
        let suggestedName = provider.suggestedName
        return try await withCheckedThrowingContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, error in
                do {
                    if let error { throw error }
                    guard let url else { throw RouteFile.Failure.unsupported }
                    let actualExtension = url.pathExtension.lowercased()
                    var filename = ["gpx", "fit"].contains(actualExtension) ? url.lastPathComponent : suggestedName ?? url.lastPathComponent
                    if !["gpx", "fit"].contains((filename as NSString).pathExtension.lowercased()) {
                        if type.lowercased().contains("gpx") { filename += ".gpx" }
                        else if type.lowercased().contains("fit") { filename += ".fit" }
                    }
                    continuation.resume(returning: try RouteFile.read(url, filename: filename))
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
}
