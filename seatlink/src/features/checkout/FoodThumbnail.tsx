import { useState } from 'react'
import Icon from '../../components/Icon'
import './FoodThumbnail.css'

const images: Record<string, string> = {
  'chicken rice': 'chicken-rice', 'vegetable noodles': 'vegetable-noodles',
  'iced tea': 'iced-tea', 'lime juice': 'lime-juice',
}
export default function FoodThumbnail({ name }: { name: string }) {
  const source = images[name.toLowerCase().replace(/^sample\s+/, '').trim()]
  const [failed, setFailed] = useState<string>()
  return <div className="food-thumbnail">{source && failed !== source ?
    <img src={`/food/${source}.svg`} alt={`Illustration of ${name}`} width="240" height="160" loading="lazy" onError={() => setFailed(source)} /> :
    <span className="food-fallback" role="img" aria-label={`No image available for ${name}`}><Icon name="food" /></span>}</div>
}
