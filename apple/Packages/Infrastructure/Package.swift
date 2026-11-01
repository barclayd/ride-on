// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Infrastructure",
    platforms: [.iOS("27.1"), .macOS("27.0")],
    products: [
        .library(name: "Networking", type: .static, targets: ["Networking"]),
        .library(name: "Persistence", type: .static, targets: ["Persistence"]),
        .library(name: "PlatformServices", type: .static, targets: ["PlatformServices"]),
    ],
    dependencies: [
        .package(path: "../Domain"),
        .package(path: "../Models"),
        .package(path: "../Engine"),
    ],
    targets: [
        .target(name: "Networking", dependencies: ["Domain"]),
        .target(name: "Persistence", dependencies: ["Models", "Domain", "Engine"]),
        .target(name: "PlatformServices", dependencies: ["Domain", "Engine", "Networking"]),
        .testTarget(name: "NetworkingTests", dependencies: ["Networking", "Domain"], resources: [.copy("Fixtures")]),
    ]
)
