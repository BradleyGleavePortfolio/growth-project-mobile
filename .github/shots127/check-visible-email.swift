import Foundation
import Vision
import ImageIO

// OCR is a publication guard, not an edited/fabricated screenshot.
let env = ProcessInfo.processInfo.environment
let emails = ["REVIEW_CLIENT_EMAIL", "REVIEW_COACH_EMAIL"]
  .compactMap { env[$0] }.filter { !$0.isEmpty }
if emails.isEmpty { exit(0) }
guard CommandLine.arguments.count == 2,
  let image = CGImageSourceCreateWithURL(
    URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL, nil),
  let cgImage = CGImageSourceCreateImageAtIndex(image, 0, nil) else { exit(1) }
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
do {
  try VNImageRequestHandler(cgImage: cgImage).perform([request])
  let text = (request.results ?? []).compactMap {
    $0.topCandidates(1).first?.string
  }.joined().lowercased().filter { !$0.isWhitespace }
  for email in emails {
    if text.contains(email.lowercased().filter { !$0.isWhitespace }) { exit(1) }
  }
} catch { exit(1) }
