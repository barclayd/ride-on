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
        .library(name: "TodayUI", type: .static, targets: ["TodayUI"]),
        .library(name: "RoutesUI", type: .static, targets: ["RoutesUI"]),
        .library(name: "YouUI", type: .static, targets: ["YouUI"]),
        .library(name: "OnboardingUI", type: .static, targets: ["OnboardingUI"]),
        .library(name: "SharedUI", type: .static, targets: ["SharedUI"]),
    ],
    dependencies: [
        .package(path: "../Models"),
        .package(path: "../Engine"),
        .package(path: "../Services"),
        .package(path: "../DesignSystem"),
        .package(path: "../Router"),
    ],
    targets: [
        .target(
            name: "SharedUI",
            dependencies: baseDeps),
        .target(
            name: "TodayUI",
            dependencies: baseDeps + ["SharedUI"]),
        .target(
            name: "RoutesUI",
            dependencies: baseDeps + ["SharedUI"]),
        .target(
            name: "YouUI",
            dependencies: baseDeps + ["SharedUI"]),
        .target(
            name: "OnboardingUI",
            dependencies: baseDeps + ["SharedUI"]),
    ])
