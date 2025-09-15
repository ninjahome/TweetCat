//
//  FormatSheetView.swift
//  TweetCatApp
//
//  Created by wesley on 2025/9/10.
//

import SwiftUI

struct FormatSheetView: View {
    let options: [UIFormatOption]
    @Binding var selectedID: UIFormatOption.ID?
    let onCancel: () -> Void
    let onConfirm: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                List {
                    ForEach(UIFormatOption.Compatibility.allCases, id: \.self) {
                        category in
                        let group = options.filter {
                            $0.compatibility == category
                        }
                        Section(category.rawValue) {
                            ForEach(group) { f in
                                FormatRowView(
                                    option: f,
                                    isSelected: selectedID == f.id
                                )
                                .contentShape(Rectangle())
                                .onTapGesture { selectedID = f.id }
                            }
                        }
                    }
                }
                .listStyle(.inset)

                Divider()

                HStack {
                    Spacer()
                    Button("取消", action: onCancel)
                    Button("开始下载") {
                        onConfirm()
                    }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                }
                .padding()
            }
            .navigationTitle("选择下载格式")
        }
    }
}

private struct FormatRowView: View {
    let option: UIFormatOption
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 12) {
            kindBadge
            Text(option.resolution)
                .font(.body)

            Spacer(minLength: 8)

            Text(option.container.uppercased())
                .font(.callout)
                .foregroundStyle(.secondary)

            if let size = option.estSizeMB {
                Text("≈\(size) MB")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            if let note = option.note, !note.isEmpty {
                Text(note)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .imageScale(.medium)
        }
    }

    private var kindBadge: some View {
        Text(option.kind.rawValue)
            .font(.caption)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(.secondary.opacity(0.15))
            )
    }
}
