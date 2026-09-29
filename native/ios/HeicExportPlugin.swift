import Foundation
import Capacitor
import ImageIO
import UniformTypeIdentifiers

// Add to the iOS App target and register HeicExportPlugin with CAPBridgeViewController.
// Web/PWA never advertises this capability; native release validation is required.
@objc(HeicExportPlugin)
public class HeicExportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HeicExportPlugin"
    public let jsName = "HeicExport"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "encode", returnType: CAPPluginReturnPromise)]

    @objc func encode(_ call: CAPPluginCall) {
        guard let png = call.getString("png"), let data = Data(base64Encoded: png) else {
            call.reject("Invalid source image"); return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            autoreleasepool {
                guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
                    call.reject("Cannot decode source image"); return
                }
                let output = NSMutableData()
                guard let destination = CGImageDestinationCreateWithData(output, UTType.heic.identifier as CFString, 1, nil) else {
                    call.reject("HEIC encoding is unavailable on this device"); return
                }
                CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 1.0] as CFDictionary)
                guard CGImageDestinationFinalize(destination) else {
                    call.reject("HEIC encoding failed"); return
                }
                call.resolve(["base64": output.base64EncodedString()])
            }
        }
    }
}
