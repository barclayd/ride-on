// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Models",
    platforms: [.iOS("27.1"), .macOS("27.0")],
    products: [
        .library(name: "Models", type: .static, targets: ["Models"]),
    ],
    targets: [
        .target(name: "Models"),
        .testTarget(name: "ModelsTests", dependencies: ["Models"]),
    ]
)
