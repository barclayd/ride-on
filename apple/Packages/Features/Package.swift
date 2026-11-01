// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Features",
    platforms: [.iOS("27.1"), .macOS("27.0")],
    products: [
        .library(name: "SharedUI", type: .static, targets: ["SharedUI"]),
        .library(name: "RideUI", type: .static, targets: ["RideUI"]),
        .library(name: "RoutesUI", type: .static, targets: ["RoutesUI"]),
        .library(name: "PreferencesUI", type: .static, targets: ["PreferencesUI"]),
        .library(name: "OnboardingUI", type: .static, targets: ["OnboardingUI"]),
    ],
    dependencies: [
        .package(path: "../Domain"),
        .package(path: "../Models"),
        .package(path: "../Engine"),
        .package(path: "../Services"),
        .package(path: "../DesignSystem"),
        .package(path: "../Infrastructure"),
        .package(url: "https://github.com/maplibre/maplibre-gl-native-distribution", exact: "6.31.0"),
    ],
    targets: [
        .target(name: "SharedUI", dependencies: [
            .product(name: "DesignSystem", package: "DesignSystem"),
            .product(name: "Domain", package: "Domain"),
            .product(name: "Engine", package: "Engine"),
            .product(name: "Models", package: "Models"),
            .product(name: "Persistence", package: "Infrastructure"),
            .product(name: "PlatformServices", package: "Infrastructure"),
            .product(name: "Services", package: "Services"),
            .product(name: "MapLibre", package: "maplibre-gl-native-distribution", condition: .when(platforms: [.iOS]))
        ], resources: [.copy("CycleMap")]),
        .target(name: "RideUI", dependencies: [
            .product(name: "DesignSystem", package: "DesignSystem"),
            .product(name: "Domain", package: "Domain"),
            .product(name: "Engine", package: "Engine"),
            .product(name: "Networking", package: "Infrastructure"),
            .product(name: "Services", package: "Services"),
            "SharedUI"
        ]),
        .target(name: "RoutesUI", dependencies: [
            .product(name: "DesignSystem", package: "DesignSystem"),
            .product(name: "Domain", package: "Domain"),
            .product(name: "Networking", package: "Infrastructure"),
            .product(name: "Services", package: "Services"),
            "SharedUI"
        ]),
        .target(name: "PreferencesUI", dependencies: [
            .product(name: "DesignSystem", package: "DesignSystem"),
            .product(name: "Domain", package: "Domain"),
            .product(name: "Networking", package: "Infrastructure"),
            .product(name: "Persistence", package: "Infrastructure"),
            .product(name: "PlatformServices", package: "Infrastructure"),
            .product(name: "Services", package: "Services"),
            "SharedUI"
        ]),
        .target(name: "OnboardingUI", dependencies: [
            .product(name: "DesignSystem", package: "DesignSystem"),
            .product(name: "Domain", package: "Domain"),
            .product(name: "Persistence", package: "Infrastructure"),
            .product(name: "Services", package: "Services"),
            "SharedUI"
        ]),
        .testTarget(name: "SharedUITests", dependencies: ["SharedUI", .product(name: "Domain", package: "Domain")]),
    ]
)
