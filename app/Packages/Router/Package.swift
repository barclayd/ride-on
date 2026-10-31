// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Router",
    platforms: [.iOS("27.1"), .macOS("27.0")],
    products: [
        .library(name: "Router", type: .static, targets: ["Router"]),
    ],
    targets: [
        .target(name: "Router"),
    ]
)
