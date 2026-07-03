// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RideOnCore",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "RideOnCore", targets: ["RideOnCore"])
    ],
    targets: [
        .target(name: "RideOnCore"),
        .testTarget(
            name: "RideOnCoreTests",
            dependencies: ["RideOnCore"],
            path: "Tests",
            sources: ["RideOnCoreTests"],
            resources: [.copy("Fixtures")]
        )
    ]
)
