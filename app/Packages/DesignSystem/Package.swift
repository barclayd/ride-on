// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "DesignSystem",
    platforms: [.iOS("27.1"), .macOS("27.0")],
    products: [
        .library(name: "DesignSystem", type: .static, targets: ["DesignSystem"]),
    ],
    targets: [
        .target(name: "DesignSystem"),
    ]
)
