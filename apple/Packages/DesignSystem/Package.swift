// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "DesignSystem",
    platforms: [.iOS("27.1"), .macOS("27.0")],
    products: [
        .library(name: "DesignSystem", type: .static, targets: ["DesignSystem"]),
    ],
    dependencies: [
        .package(path: "../Domain"),
    ],
    targets: [
        .target(name: "DesignSystem", dependencies: ["Domain"]),
    ]
)
