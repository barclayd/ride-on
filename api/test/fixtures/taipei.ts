// Synthetic river-corridor polylines, not surveyed or navigable cycling tracks.
// Constant elevation isolates weather from climbing preferences.
export const taipeiRoutes = [
  {
    name: 'Taipei northwest river corridor',
    points: [
      [25.056, 121.508],
      [25.066, 121.508],
      [25.077, 121.504],
      [25.088, 121.497],
      [25.099, 121.488],
      [25.109, 121.478],
      [25.119, 121.468],
      [25.125, 121.461],
    ],
  },
  {
    name: 'Taipei east river corridor',
    points: [
      [25.078, 121.539],
      [25.077, 121.55],
      [25.073, 121.561],
      [25.069, 121.572],
      [25.067, 121.583],
      [25.066, 121.594],
      [25.066, 121.605],
      [25.066, 121.616],
    ],
  },
] as const;

export const taipeiGpx = (route: (typeof taipeiRoutes)[number]) =>
  `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${route.name}</name><trkseg>${route.points.map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"><ele>10</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;
