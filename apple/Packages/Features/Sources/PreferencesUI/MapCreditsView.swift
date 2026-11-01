#if os(iOS)
import SwiftUI

/// Preferences → Maps: who the cycle map is built from, each linking to its terms (DESIGN-SYSTEM.md
/// §2). The map shows "© OpenStreetMap" only until it's moved or for 5 seconds, so this is where the
/// credits stay. The Mac draws MapKit, which carries its own.
struct MapCreditsView: View {
    var body: some View {
        Form {
            Section("Map") {
                credit("OpenStreetMap", "Map data © OpenStreetMap contributors, available under the Open Database Licence.",
                       "https://www.openstreetmap.org/copyright")
                credit("Protomaps", "The basemap, from Protomaps' build of OpenStreetMap.", "https://protomaps.com")
            }
            Section("Terrain") {
                credit("Mapterhorn", "Hill shading, from Mapterhorn's elevation data and the sources it credits.",
                       "https://mapterhorn.com/attribution")
                // The Open Government Licence's attribution statement, as OS words it.
                credit("Ordnance Survey", "Contours from OS Terrain 50. Contains OS data © Crown copyright and database right 2026, under the Open Government Licence v3.0.",
                       "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/")
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Maps")
    }

    private func credit(_ name: String, _ detail: String, _ url: String) -> some View {
        Link(destination: URL(string: url)!) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .foregroundStyle(.primary)
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
    }
}
#endif
