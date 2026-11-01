// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Services",
    platforms: [.iOS("27.1"), .macOS("27.0")],
    products: [
        .library(name: "Services", type: .static, targets: ["Services"]),
    ],
    dependencies: [
        .package(path: "../Domain"),
        .package(path: "../Models"),
        .package(path: "../Engine"),
        .package(path: "../Infrastructure"),
    ],
    targets: [
        .target(name: "Services", dependencies: ["Domain", "Models", "Engine", .product(name: "Networking", package: "Infrastructure"), .product(name: "Persistence", package: "Infrastructure"), .product(name: "PlatformServices", package: "Infrastructure")]),
        .testTarget(name: "ServicesTests", dependencies: ["Services", "Domain", "Models", "Engine", .product(name: "Networking", package: "Infrastructure"), .product(name: "Persistence", package: "Infrastructure"), .product(name: "PlatformServices", package: "Infrastructure")]),
    ]
)
