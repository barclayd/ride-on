// swift-tools-version: 6.2
import PackageDescription

let baseDeps: [PackageDescription.Target.Dependency] = [
    .product(name: "Models", package: "Models"),
    .product(name: "Engine", package: "Engine"),
    .product(name: "Services", package: "Services"),
    .product(name: "DesignSystem", package: "DesignSystem"),
    .product(name: "Router", package: "Router"),
]

let package = Package(
    name: "Features",
    platforms: [.iOS("26.0"), .macOS("26.0")],
    products: [
        .library(name: "RideUI", type: .static, targets: ["RideUI"]),
        .library(name: "RoutesUI", type: .static, targets: ["RoutesUI"]),
        .library(name: "PreferencesUI", type: .static, targets: ["PreferencesUI"]),
        .library(name: "OnboardingUI", type: .static, targets: ["OnboardingUI"]),
        .library(name: "SharedUI", type: .static, targets: ["SharedUI"]),
    ],
    dependencies: [
        .package(path: "../Models"),
        .package(path: "../Engine"),
        .package(path: "../Services"),
        .package(path: "../DesignSystem"),
        .package(path: "../Router"),
        // iOS only: MapLibre Native has no macOS build (docs/maps/README.md, WS3).
        .package(url: "https://github.com/maplibre/maplibre-gl-native-distribution", exact: "6.31.0"),
    ],
    targets: [
        .target(
            name: "SharedUI",
            dependencies: baseDeps),
        .target(
            name: "RideUI",
            dependencies: baseDeps + ["SharedUI"]),
        .target(
            name: "RoutesUI",
            dependencies: baseDeps + [
                "SharedUI",
                .product(name: "MapLibre", package: "maplibre-gl-native-distribution",
                         condition: .when(platforms: [.iOS])),
            ],
            resources: [.copy("CycleMapSpike")]),
        .target(
            name: "PreferencesUI",
            dependencies: baseDeps + ["SharedUI"]),
        .target(
            name: "OnboardingUI",
            dependencies: baseDeps + ["SharedUI"]),
        .testTarget(
            name: "SharedUITests",
            dependencies: ["SharedUI"]),
    ])
