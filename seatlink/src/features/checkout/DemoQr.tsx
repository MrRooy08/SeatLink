import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export default function DemoQr({ text }: { text: string }) {
  const [image, setImage] = useState<{ text: string; url: string }>()
  const [failedFor, setFailedFor] = useState<string>()

  useEffect(() => {
    let active = true
    void QRCode.toDataURL(text, { width: 280, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }).then(
      (url) => { if (active) setImage({ text, url }) },
      () => { if (active) setFailedFor(text) },
    )
    return () => { active = false }
  }, [text])

  return (
    <figure className="demo-qr">
      {image?.text === text ? <img src={image.url} width="240" height="240" alt="Demo payment QR, no real charge" /> :
        <p role="status">{failedFor === text ? 'Couldn’t render the demo QR.' : 'Loading demo QR…'}</p>}
      <figcaption>Demo QR · No real charge</figcaption>
    </figure>
  )
}
