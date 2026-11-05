// Synthetic forecasts using CWA's current public datastore schema. Coordinates
// identify a real representative point; forecast values are deliberately synthetic.
export const CWA_NOW = '2026-11-05T00:00:00.000Z';
export const cwaLocation = {
  id: 'taipei',
  coordinate: { latitude: 25.051608, longitude: 121.568983 },
};
const local = (hour: number) =>
  `2026-11-05T${String(hour).padStart(2, '0')}:00:00+08:00`;
export const cwaFixture = () => ({
  success: 'true',
  result: { resource_id: 'F-D0047-061', fields: [] },
  records: {
    Locations: [
      {
        DatasetDescription: '臺灣各縣市鄉鎮未來3天天氣預報',
        LocationsName: '臺北市',
        Dataid: 'D0047-061',
        Location: [
          {
            LocationName: '松山區',
            Geocode: '63000010',
            Latitude: '25.051608',
            Longitude: '121.568983',
            WeatherElement: [
              ...[
                ['溫度', 'Temperature', '23'],
                ['體感溫度', 'ApparentTemperature', '25'],
                ['風速', 'WindSpeed', '3'],
                ['風向', 'WindDirection', '東北風'],
              ].map(([ElementName = '', field = '', value = '']) => ({
                ElementName,
                Time: [9, 12, 15].map((hour) => ({
                  DataTime: local(hour),
                  ElementValue: [{ [field]: value }],
                })),
              })),
              {
                ElementName: '3小時降雨機率',
                Time: [9, 12, 15].map((hour) => ({
                  StartTime: local(hour),
                  EndTime: local(hour + 3),
                  ElementValue: [{ ProbabilityOfPrecipitation: '30' }],
                })),
              },
            ],
          },
        ],
      },
    ],
  },
});
