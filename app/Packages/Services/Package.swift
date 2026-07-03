// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Services",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [
        .library(name: "Services", type: .static, targets: ["Services"]),
    ],
    dependencies: [
        .package(path: "../Models"),
        .package(path: "../Engine"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "Services",
            dependencies: ["Models", "Engine", "DesignSystem"]
        ),
    ]
)
