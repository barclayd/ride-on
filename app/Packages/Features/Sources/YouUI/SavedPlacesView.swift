import SwiftUI
import SwiftData
import Models

/// Saved start locations (home, work, ...) for ETA scoring — plain CRUD over
/// `SavedPlaceModel`. No map-based location picker in Phase 4 scope; lat/lon
/// entry is enough for a fixture-world-testable settings screen.
struct SavedPlacesView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \SavedPlaceModel.name) private var places: [SavedPlaceModel]
    @State private var isAddPresented = false

    var body: some View {
        List {
            ForEach(places) { place in
                VStack(alignment: .leading) {
                    Text(place.name).font(.headline)
                    Text("\(place.coordinate.latitude.formatted(.number.precision(.fractionLength(3)))), \(place.coordinate.longitude.formatted(.number.precision(.fractionLength(3))))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .onDelete { indexSet in
                for index in indexSet { modelContext.delete(places[index]) }
            }
        }
        .navigationTitle("Saved Places")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add", systemImage: "plus") { isAddPresented = true }
            }
        }
        .sheet(isPresented: $isAddPresented) {
            AddSavedPlaceSheet()
        }
        .overlay {
            if places.isEmpty {
                ContentUnavailableView("No Saved Places", systemImage: "mappin.and.ellipse")
            }
        }
    }
}

private struct AddSavedPlaceSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @State private var name = ""
    @State private var latitude = ""
    @State private var longitude = ""

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $name)
                TextField("Latitude", text: $latitude)
                    #if os(iOS)
                    .keyboardType(.decimalPad)
                    #endif
                TextField("Longitude", text: $longitude)
                    #if os(iOS)
                    .keyboardType(.decimalPad)
                    #endif
            }
            .formStyle(.grouped)
            .navigationTitle("New Place")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(name.isEmpty || Double(latitude) == nil || Double(longitude) == nil)
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func save() {
        guard let lat = Double(latitude), let lon = Double(longitude) else { return }
        modelContext.insert(SavedPlaceModel(name: name, coordinate: Coordinate(latitude: lat, longitude: lon)))
        dismiss()
    }
}
