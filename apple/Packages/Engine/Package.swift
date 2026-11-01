// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Engine",
    platforms: [.iOS("27.1"), .macOS("27.0")],
    products: [
        .library(name: "Engine", type: .static, targets: ["Engine"]),
    ],
    dependencies: [
        .package(path: "../Domain"),
    ],
    targets: [
        .target(
            name: "Engine",
            dependencies: ["Domain"]
        ),
        .testTarget(
            name: "EngineTests",
            dependencies: ["Engine", "Domain"],
            path: "Tests",
            sources: ["EngineTests"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
