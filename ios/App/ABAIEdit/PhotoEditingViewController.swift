//
//  PhotoEditingViewController.swift
//  ABAI 相簿編輯擴充
//
//  在「照片」App 裡選一張照片 → 編輯 → ⋯ → ABAI，就能直接套 ABAI 的濾鏡，不必先匯出再匯入。
//  ‧ 用的是 App 裡同一批濾鏡 LUT、同一個原生影像核心（ABAIImageCore），顏色跟 App 一致。
//  ‧ 存回去的是「可逆的編輯」：Photos 保留原圖，隨時能回復；再次用 ABAI 打開時，
//    會從原圖、照上次選的濾鏡和強度接著調。
//  ‧ 擴充可用的記憶體很少（約一百多 MB）：預覽只用 Photos 給的螢幕大小影像，
//    存檔時 Core Image 會分塊處理整張原圖。
//

import UIKit
import Photos
import PhotosUI
import CoreImage

final class PhotoEditingViewController: UIViewController, PHContentEditingController {

    private struct Settings: Codable {
        var kind = "lut"
        var lut: String?          // 例如 "f3.webp"；nil＝原始
        var amount: Double = 1
    }

    private var input: PHContentEditingInput?
    private var settings = Settings()
    private var preview: CIImage?
    private let imageView = UIImageView()
    private let slider = UISlider()
    private var buttons: [UIButton] = []
    private let luts: [String?] = [nil] + (1...23).map { "f\($0).webp" }

    // MARK: 介面

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        imageView.contentMode = .scaleAspectFit
        imageView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(imageView)

        let scroll = UIScrollView()
        scroll.showsHorizontalScrollIndicator = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        view.addSubview(scroll)

        for (i, lut) in luts.enumerated() {
            let b = UIButton(type: .system)
            b.setTitle(lut == nil ? "原始" : "F\(i)", for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 14, weight: .bold)
            b.setTitleColor(.white, for: .normal)
            b.backgroundColor = UIColor(white: 0.12, alpha: 1)
            b.layer.cornerRadius = 10
            b.tag = i
            b.contentEdgeInsets = UIEdgeInsets(top: 10, left: 14, bottom: 10, right: 14)
            b.addTarget(self, action: #selector(pickLut(_:)), for: .touchUpInside)
            stack.addArrangedSubview(b)
            buttons.append(b)
        }

        slider.minimumValue = 0
        slider.maximumValue = 1
        slider.value = 1
        slider.tintColor = .white
        slider.translatesAutoresizingMaskIntoConstraints = false
        slider.addTarget(self, action: #selector(amountChanged), for: .valueChanged)
        view.addSubview(slider)

        NSLayoutConstraint.activate([
            imageView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            imageView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            imageView.bottomAnchor.constraint(equalTo: slider.topAnchor, constant: -16),
            slider.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            slider.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            slider.bottomAnchor.constraint(equalTo: scroll.topAnchor, constant: -12),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
            scroll.heightAnchor.constraint(equalToConstant: 48),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
        ])
    }

    @objc private func pickLut(_ sender: UIButton) {
        settings.lut = luts[sender.tag]
        UISelectionFeedbackGenerator().selectionChanged()
        refresh()
    }

    @objc private func amountChanged() {
        settings.amount = Double(slider.value)
        refresh()
    }

    private func cube() -> ABAIImageCore.Cube? {
        guard let name = settings.lut, let url = ABAIImageCore.bundledLut(name) else { return nil }
        return ABAIImageCore.cube(fromAtlas: url)
    }

    private func refresh() {
        for (i, b) in buttons.enumerated() {
            let on = luts[i] == settings.lut
            b.backgroundColor = on ? .white : UIColor(white: 0.12, alpha: 1)
            b.setTitleColor(on ? .black : .white, for: .normal)
        }
        slider.isEnabled = settings.lut != nil
        guard let base = preview else { return }
        var img = base
        if let c = cube() { img = ABAIImageCore.apply(cube: c, to: img, amount: settings.amount) }
        if let cg = ABAIImageCore.context.createCGImage(img, from: img.extent, format: .RGBA8, colorSpace: ABAIImageCore.displayP3) {
            imageView.image = UIImage(cgImage: cg)
        }
    }

    // MARK: PHContentEditingController

    /// 只有「純濾鏡」的編輯清單看得懂。App 裡做的複雜編輯，這裡接著改的是成品，不是原圖。
    func canHandle(_ adjustmentData: PHAdjustmentData) -> Bool {
        guard adjustmentData.formatIdentifier == ABAIAdjustment.formatIdentifier,
              let s = try? JSONDecoder().decode(Settings.self, from: adjustmentData.data) else { return false }
        return s.kind == "lut"
    }

    func startContentEditing(with contentEditingInput: PHContentEditingInput, placeholderImage: UIImage) {
        input = contentEditingInput
        if let adj = contentEditingInput.adjustmentData, canHandle(adj),
           let s = try? JSONDecoder().decode(Settings.self, from: adj.data) { settings = s }
        slider.value = Float(settings.amount)
        if let img = contentEditingInput.displaySizeImage, let cg = img.cgImage {
            preview = CIImage(cgImage: cg).oriented(CGImagePropertyOrientation(img.imageOrientation))
        } else if let url = contentEditingInput.fullSizeImageURL, let cg = ABAIImageCore.downsample(url, maxPixel: 2048) {
            preview = CIImage(cgImage: cg)
        }
        imageView.image = placeholderImage
        refresh()
    }

    func finishContentEditing(completionHandler: @escaping (PHContentEditingOutput?) -> Void) {
        guard let input = input else { completionHandler(nil); return }
        let settings = self.settings
        let cube = self.cube()
        DispatchQueue.global(qos: .userInitiated).async {
            let output = PHContentEditingOutput(contentEditingInput: input)
            guard let url = input.fullSizeImageURL, var img = ABAIImageCore.ciImage(url) else { completionHandler(nil); return }
            if let c = cube { img = ABAIImageCore.apply(cube: c, to: img, amount: settings.amount) }
            do {
                let data = try ABAIImageCore.encode(img, format: .jpeg, quality: 0.97)
                try data.write(to: output.renderedContentURL)
                output.adjustmentData = PHAdjustmentData(formatIdentifier: ABAIAdjustment.formatIdentifier,
                                                         formatVersion: ABAIAdjustment.formatVersion,
                                                         data: try JSONEncoder().encode(settings))
                completionHandler(output)
            } catch {
                completionHandler(nil)
            }
        }
    }

    var shouldShowCancelConfirmation: Bool { false }

    func cancelContentEditing() {}
}

private extension CGImagePropertyOrientation {
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
