// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Engine",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [
        .library(name: "Engine", type: .static, targets: ["Engine"]),
    ],
    dependencies: [
        .package(path: "../Models"),
    ],
    targets: [
        .target(
            name: "Engine",
            dependencies: ["Models"]
        ),
        .testTarget(
            name: "EngineTests",
            dependencies: ["Engine", "Models"],
            path: "Tests",
            sources: ["EngineTests"],
            resources: [.copy("Fixtures")]
        ),
    ]
)
