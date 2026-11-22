// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import FoodThumbnail from '../src/features/checkout/FoodThumbnail'

afterEach(cleanup)
it('uses a matching original illustration and a neutral fallback for unknown food', () => {
  const view = render(<FoodThumbnail name="Sample chicken rice" />)
  const image = screen.getByRole('img', { name: 'Illustration of Sample chicken rice' })
  expect(image.getAttribute('src')).toBe('/food/chicken-rice.svg')
  fireEvent.error(image)
  expect(screen.getByRole('img', { name: 'No image available for Sample chicken rice' })).toBeTruthy()
  view.rerender(<FoodThumbnail name="Chocolate cake" />)
  expect(screen.getByRole('img', { name: 'No image available for Chocolate cake' })).toBeTruthy()
  expect(screen.queryByAltText(/Illustration/)).toBeNull()
})
