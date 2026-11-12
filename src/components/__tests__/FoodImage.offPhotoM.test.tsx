// OFF-PHOTO-M case 12: the food tile asks no logo host. The logo host the tile used (logo.clearbit.com) no longer
// serves logos (LO-FOOD C12), so on main the overlay's request fails and the tile shows the photo or the letter
// alone (FoodImage.tsx:34). That is the look kept here, with no request. The item names are made up.
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import FoodImage from '../FoodImage';
import { radius } from '../../theme/tokens';

type HostNode = { type: string; props: Record<string, unknown>; children: Array<HostNode | string> | null };
/** The host Image elements in a rendered tree (RNTL 14 has no UNSAFE_ type queries). */
function imagesIn(tree: unknown): HostNode[] {
  const found: HostNode[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const node = n as HostNode;
    if (node.type === 'Image') found.push(node);
    (node.children ?? []).forEach(walk);
  };
  walk(tree);
  return found;
}

const LATTE_PHOTO = 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=100&h=100&fit=crop';

describe('OFF-PHOTO-M case 12: no logo overlay on the food tile', () => {
  it('a shop word in the name: the letter tile alone, no image request at all', async () => {
    const view = await render(<FoodImage name="Starbucks Pumpkin Frappe" size={48} />);
    expect(imagesIn(view.toJSON())).toHaveLength(0);
    expect(screen.getByText('S')).toBeTruthy();
    expect(JSON.stringify(view.toJSON())).not.toMatch(/clearbit|logo\./i);
  });

  it('a shop word in the brand only: the food photo alone, one image', async () => {
    const view = await render(<FoodImage name="Latte" brand="Starbucks" size={44} />);
    const images = imagesIn(view.toJSON());
    expect(images).toHaveLength(1);
    expect((images[0].props.source as { uri: string }).uri).toBe(LATTE_PHOTO);
    // The photo keeps its size and the C2 corner (STYLEC-916: 12 at every size).
    expect(StyleSheet.flatten(images[0].props.style as never)).toEqual(expect.objectContaining({ width: 44, height: 44, borderRadius: radius.input }));
    expect(JSON.stringify(view.toJSON())).not.toMatch(/clearbit|logo\./i);
  });

  it.each([
    ['McDonald’s style Big Burger', undefined],
    ['Chipotle bowl', undefined],
    ['Whole grain loaf', 'Trader Joe’s'],
    ['Granola', 'Costco Kirkland'],
  ])('%s (brand %s): one tile, no overlay', async (name, brand) => {
    const view = await render(<FoodImage name={name} brand={brand} />);
    expect(imagesIn(view.toJSON()).length).toBeLessThanOrEqual(1);
    expect(JSON.stringify(view.toJSON())).not.toMatch(/clearbit|logo\./i);
  });
});
