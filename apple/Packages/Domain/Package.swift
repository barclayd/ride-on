// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Domain",
    platforms: [.iOS("27.1"), .macOS("27.0")],
    products: [
        .library(name: "Domain", type: .static, targets: ["Domain"]),
    ],
    dependencies: [
    ],
    targets: [
        .target(name: "Domain", dependencies: []),
    ]
)
