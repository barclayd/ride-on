export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["createUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getUser"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["updateUser"];
        trace?: never;
    };
    "/users/me/pause": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["pause"];
        post?: never;
        delete: operations["resume"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/route-sources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getSources"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/route-imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["importRoute"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/route-selection": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getSelection"];
        put: operations["updateSelection"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getRoutes"];
        put?: never;
        post: operations["uploadRoute"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routes/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getRoute"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routes/{id}/surface": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getRouteSurface"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/routes/{id}/geometry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getRouteGeometry"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Health: {
            /** @enum {boolean} */
            ok: true;
            version: string;
            algorithmVersion: string;
            revision: string | null;
        };
        UserResponse: {
            user: components["schemas"]["User"];
        };
        User: {
            /** @enum {number} */
            schemaVersion: 1;
            id: string;
            version: number;
            displayName: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            settings: {
                /** @default Europe/London */
                timeZone: string;
                riding: {
                    averageSpeedKph: number;
                    departureStepMinutes: number;
                };
                preferences: {
                    temperature: {
                        comfortMinC: number;
                        comfortMaxC: number;
                        /**
                         * @default standard
                         * @enum {string}
                         */
                        coldSensitivity: "standard" | "high";
                        /**
                         * @default none
                         * @enum {string}
                         */
                        seasonalTolerance: "none" | "cooler-winters";
                    };
                    wind: {
                        /** @default false */
                        preferTailwind: boolean;
                        /** @default false */
                        prioritiseTailwindOpportunities: boolean;
                        comfortableHeadwindKph: number;
                        comfortableCrosswindKph: number;
                        comfortableGustKph: number;
                        crosswindSensitivity: number;
                    };
                    sunshine: {
                        sunnyIntervalsComfort: number;
                    };
                    /**
                     * @default {
                     *       "mode": "neutral",
                     *       "lookbackDays": 28
                     *     }
                     */
                    recentRides: {
                        /** @enum {string} */
                        mode: "neutral" | "prefer-variety";
                        lookbackDays: number;
                    };
                    /**
                     * @default {
                     *       "preference": "neutral"
                     *     }
                     */
                    climbing: {
                        /** @enum {string} */
                        preference: "flatter" | "neutral" | "hillier";
                    };
                    /** @default null */
                    distance: {
                        minKm: number;
                        maxKm: number;
                    } | null;
                    weights: {
                        temperature: number;
                        wind: number;
                        dryness: number;
                        clearSkies: number;
                        sunshine: number;
                    };
                    minimumStandards: {
                        minimumTemperature?: {
                            /** @enum {string} */
                            kind: "fixed";
                            valueC: number;
                        } | {
                            /** @enum {string} */
                            kind: "monthly";
                            valuesC: {
                                [key: string]: number;
                            };
                            /** @default null */
                            fallbackC: number | null;
                        };
                        maximumTemperatureC?: number;
                        maximumGustKph?: number;
                        maximumPrecipitationProbability?: number;
                        maximumPrecipitationRateMmH?: number;
                    };
                };
                forecast: {
                    /** @enum {string} */
                    representation: "deterministic" | "ensemble-summary";
                    /** @enum {string} */
                    freshnessBasis: "model-run" | "retrieval-time";
                };
                weather: {
                    /** @enum {string} */
                    mode: "strict";
                    providerId: string;
                } | {
                    /** @enum {string} */
                    mode: "ordered-fallback";
                    providerIds: [
                        string
                    ];
                };
                /**
                 * @default {
                 *       "days": {
                 *         "kind": "preset",
                 *         "preset": "next"
                 *       },
                 *       "window": "daylight"
                 *     }
                 */
                planning: {
                    days: {
                        /** @enum {string} */
                        kind: "preset";
                        /** @enum {string} */
                        preset: "today" | "tomorrow" | "weekend" | "next" | "next-five-days";
                    } | {
                        /** @enum {string} */
                        kind: "range";
                        /** Format: date */
                        start: string;
                        /** Format: date */
                        end: string;
                    } | {
                        /** @enum {string} */
                        kind: "dates";
                        dates: string[];
                    };
                    window: "daylight" | {
                        start: string;
                        end: string;
                    };
                };
                /**
                 * @default {
                 *       "unit": "km"
                 *     }
                 */
                display: {
                    /** @enum {string} */
                    unit: "km" | "mi";
                };
                units?: {
                    /** @enum {string} */
                    temperature: "C" | "F";
                    /** @enum {string} */
                    windSpeed: "kmh" | "mph";
                };
            };
            pause: components["schemas"]["Pause"];
            weatherProviderId: string | null;
            preferenceLevels: {
                sunshine: string;
                rain: string;
                crosswind: string;
            };
        };
        Pause: {
            until: string | null;
            resumesAt: string | null;
            pausedAt: string;
        } | null;
        Error: {
            error: {
                code: string;
                message: string;
            };
        };
        RouteSources: {
            sources: {
                id: string;
                name: string;
                importModes: [
                    "gpx-upload"
                ];
                /** @enum {boolean} */
                accountConnection: false;
            }[];
        };
        RouteImportResponse: components["schemas"]["RouteResponse"] & {
            /** @enum {string} */
            outcome: "created" | "updated" | "unchanged";
        };
        RouteSummary: {
            /** Format: uuid */
            id: string;
            name: string;
            createdAt: string;
            distanceM: number;
            ascentM: number | null;
            originalPointCount: number;
            warnings: string[];
            /** @enum {string} */
            geometryStatus: "available" | "unavailable";
            surfaceSummary: components["schemas"]["SurfaceSummary"];
            source: {
                providerId: string;
                externalId: string;
            } | null;
            version: number;
            updatedAt: string;
        };
        SurfaceSummary: {
            /** @enum {string} */
            status: "complete" | "partial" | "unavailable";
            pavedM: number;
            unpavedM: number;
            nonCyclingM: number;
            unknownM: number;
            classifiedFraction: number;
            unpavedFraction: number | null;
            source: {
                /** @enum {string} */
                providerId: "cycle-travel";
                /** @enum {string} */
                method: "route-instructions";
                formatVersion: 1 | 2;
                /** @enum {number} */
                mappingVersion: 1;
            } | null;
            capturedAt: string | null;
        };
        RouteResponse: {
            route: components["schemas"]["RouteSummary"];
        };
        SurfaceInput: {
            /** @enum {number} */
            schemaVersion: 1;
            source: {
                /** @enum {string} */
                providerId: "cycle-travel";
                /** @enum {string} */
                method: "route-instructions";
                formatVersion: 1 | 2;
                /** @enum {number} */
                mappingVersion: 1;
            };
            geometryDistanceM: number;
            sections: {
                fromM: number;
                toM: number;
                /** @enum {string} */
                surface: "paved" | "compacted" | "gravel" | "rough-unpaved" | "earth" | "dirt" | "grass" | "sand" | "unpaved" | "unknown" | "non-cycling";
                sourceCode: string;
            }[];
        };
        SelectionResponse: {
            selection: {
                version: number;
                routeIds: string[];
                /** Format: date-time */
                updatedAt: string | null;
            };
        };
        RouteList: {
            routes: components["schemas"]["RouteSummary"][];
            nextCursor: string | null;
            limit: number;
        };
        RouteSurface: {
            /** Format: uuid */
            routeId: string;
            version: number;
            surface: components["schemas"]["SurfaceInput"] & ({
                sourceHash: string;
                /** Format: date-time */
                capturedAt: string;
            } | null);
            summary: components["schemas"]["SurfaceSummary"];
        };
        RouteGeometry: {
            /** Format: uuid */
            routeId: string;
            version: number;
            geometry: {
                /** @enum {number} */
                version: 1;
                /** @enum {string} */
                encoding: "polyline6";
                data: string;
                pointCount: number;
            } | null;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    health: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    createUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    displayName: string;
                    settings?: {
                        /** @enum {string} */
                        weatherProviderId?: "apple-weather" | "met-office";
                        timeZone?: string;
                        riding?: {
                            averageSpeedKph?: number;
                            departureStepMinutes?: number;
                        };
                        preferences?: {
                            temperature?: {
                                comfortMinC?: number;
                                comfortMaxC?: number;
                                /** @enum {string} */
                                coldSensitivity?: "standard" | "high";
                                /** @enum {string} */
                                seasonalTolerance?: "none" | "cooler-winters";
                            };
                            wind?: {
                                preferTailwind?: boolean;
                                prioritiseTailwindOpportunities?: boolean;
                                comfortableHeadwindKph?: number;
                                comfortableCrosswindKph?: number;
                                comfortableGustKph?: number;
                                crosswindSensitivity?: number;
                            };
                            sunshine?: {
                                sunnyIntervalsComfort?: number;
                            };
                            recentRides?: {
                                /** @enum {string} */
                                mode?: "neutral" | "prefer-variety";
                                lookbackDays?: number;
                            };
                            climbing?: {
                                /** @enum {string} */
                                preference?: "flatter" | "neutral" | "hillier";
                            };
                            distance?: {
                                minKm: number;
                                maxKm: number;
                            } | null;
                            weights?: {
                                temperature?: number;
                                wind?: number;
                                dryness?: number;
                                clearSkies?: number;
                                sunshine?: number;
                            };
                            minimumStandards?: {
                                minimumTemperature?: {
                                    /** @enum {string} */
                                    kind: "fixed";
                                    valueC: number;
                                } | {
                                    /** @enum {string} */
                                    kind: "monthly";
                                    valuesC: {
                                        [key: string]: number;
                                    };
                                    /** @default null */
                                    fallbackC?: number | null;
                                } | null;
                                maximumTemperatureC?: number | null;
                                maximumGustKph?: number | null;
                                maximumPrecipitationProbability?: number | null;
                                maximumPrecipitationRateMmH?: number | null;
                            };
                        };
                        forecast?: {
                            /** @enum {string} */
                            representation?: "deterministic" | "ensemble-summary";
                            /** @enum {string} */
                            freshnessBasis?: "model-run" | "retrieval-time";
                        };
                        weather?: {
                            /** @enum {string} */
                            mode: "strict";
                            providerId: string;
                        } | {
                            /** @enum {string} */
                            mode: "ordered-fallback";
                            providerIds: [
                                string
                            ];
                        };
                        planning?: {
                            days?: {
                                /** @enum {string} */
                                kind: "preset";
                                /** @enum {string} */
                                preset: "today" | "tomorrow" | "weekend" | "next" | "next-five-days";
                            } | {
                                /** @enum {string} */
                                kind: "range";
                                /** Format: date */
                                start: string;
                                /** Format: date */
                                end: string;
                            } | {
                                /** @enum {string} */
                                kind: "dates";
                                dates: string[];
                            };
                            window?: "daylight" | {
                                start: string;
                                end: string;
                            };
                        };
                        display?: {
                            /** @enum {string} */
                            unit?: "km" | "mi";
                        };
                        units?: {
                            /** @enum {string} */
                            temperature: "C" | "F";
                            /** @enum {string} */
                            windSpeed: "kmh" | "mph";
                        };
                        preferenceLevels?: {
                            /** @enum {string} */
                            sunshine?: "dont-mind" | "nice" | "important";
                            /** @enum {string} */
                            rain?: "dont-mind" | "light-ok" | "avoid";
                            /** @enum {string} */
                            crosswind?: "low" | "normal" | "high";
                        };
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponse"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponse"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedVersion: number;
                    displayName?: string;
                    settings?: {
                        /** @enum {string} */
                        weatherProviderId?: "apple-weather" | "met-office";
                        timeZone?: string;
                        riding?: {
                            averageSpeedKph?: number;
                            departureStepMinutes?: number;
                        };
                        preferences?: {
                            temperature?: {
                                comfortMinC?: number;
                                comfortMaxC?: number;
                                /** @enum {string} */
                                coldSensitivity?: "standard" | "high";
                                /** @enum {string} */
                                seasonalTolerance?: "none" | "cooler-winters";
                            };
                            wind?: {
                                preferTailwind?: boolean;
                                prioritiseTailwindOpportunities?: boolean;
                                comfortableHeadwindKph?: number;
                                comfortableCrosswindKph?: number;
                                comfortableGustKph?: number;
                                crosswindSensitivity?: number;
                            };
                            sunshine?: {
                                sunnyIntervalsComfort?: number;
                            };
                            recentRides?: {
                                /** @enum {string} */
                                mode?: "neutral" | "prefer-variety";
                                lookbackDays?: number;
                            };
                            climbing?: {
                                /** @enum {string} */
                                preference?: "flatter" | "neutral" | "hillier";
                            };
                            distance?: {
                                minKm: number;
                                maxKm: number;
                            } | null;
                            weights?: {
                                temperature?: number;
                                wind?: number;
                                dryness?: number;
                                clearSkies?: number;
                                sunshine?: number;
                            };
                            minimumStandards?: {
                                minimumTemperature?: {
                                    /** @enum {string} */
                                    kind: "fixed";
                                    valueC: number;
                                } | {
                                    /** @enum {string} */
                                    kind: "monthly";
                                    valuesC: {
                                        [key: string]: number;
                                    };
                                    /** @default null */
                                    fallbackC?: number | null;
                                } | null;
                                maximumTemperatureC?: number | null;
                                maximumGustKph?: number | null;
                                maximumPrecipitationProbability?: number | null;
                                maximumPrecipitationRateMmH?: number | null;
                            };
                        };
                        forecast?: {
                            /** @enum {string} */
                            representation?: "deterministic" | "ensemble-summary";
                            /** @enum {string} */
                            freshnessBasis?: "model-run" | "retrieval-time";
                        };
                        weather?: {
                            /** @enum {string} */
                            mode: "strict";
                            providerId: string;
                        } | {
                            /** @enum {string} */
                            mode: "ordered-fallback";
                            providerIds: [
                                string
                            ];
                        };
                        planning?: {
                            days?: {
                                /** @enum {string} */
                                kind: "preset";
                                /** @enum {string} */
                                preset: "today" | "tomorrow" | "weekend" | "next" | "next-five-days";
                            } | {
                                /** @enum {string} */
                                kind: "range";
                                /** Format: date */
                                start: string;
                                /** Format: date */
                                end: string;
                            } | {
                                /** @enum {string} */
                                kind: "dates";
                                dates: string[];
                            };
                            window?: "daylight" | {
                                start: string;
                                end: string;
                            };
                        };
                        display?: {
                            /** @enum {string} */
                            unit?: "km" | "mi";
                        };
                        units?: {
                            /** @enum {string} */
                            temperature: "C" | "F";
                            /** @enum {string} */
                            windSpeed: "kmh" | "mph";
                        };
                        preferenceLevels?: {
                            /** @enum {string} */
                            sunshine?: "dont-mind" | "nice" | "important";
                            /** @enum {string} */
                            rain?: "dont-mind" | "light-ok" | "avoid";
                            /** @enum {string} */
                            crosswind?: "low" | "normal" | "high";
                        };
                    };
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponse"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    pause: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    until: string | null;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponse"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    resume: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponse"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getSources: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RouteSources"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    importRoute: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    source: {
                        providerId: string;
                        externalId: string;
                    };
                    gpx: string;
                    surface?: components["schemas"]["SurfaceInput"];
                    name?: string;
                    expectedVersion?: number;
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RouteImportResponse"];
                };
            };
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RouteImportResponse"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getSelection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SelectionResponse"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    updateSelection: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedVersion: number;
                    routeIds: string[];
                };
            };
        };
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SelectionResponse"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getRoutes: {
        parameters: {
            query?: {
                limit?: number;
                cursor?: string;
                sourceProviderId?: string;
                sourceExternalId?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RouteList"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    uploadRoute: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/gpx+xml": string;
                "application/xml": string;
                "text/xml": string;
                "multipart/form-data": {
                    /** Format: binary */
                    file: string;
                    name?: string;
                };
            };
        };
        responses: {
            /** @description Success */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RouteResponse"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getRoute: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RouteResponse"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getRouteSurface: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RouteSurface"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getRouteGeometry: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Success */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RouteGeometry"];
                };
            };
            /** @description Invalid input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Session required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Resource not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Version conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Body too large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported media type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Invalid operation */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
}
