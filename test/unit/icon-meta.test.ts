import { describe, it, expect } from 'vitest'
import {
  sanitizeFilename,
  toPascalCase,
  deriveCollectionName,
  deriveTypeName,
  deriveSpriteComponentName,
  buildIconMeta,
} from '../../src/utils/icon-meta'

describe('sanitizeFilename', () => {
  it('strips .svg and lowercases', () => {
    expect(sanitizeFilename('My Icon.svg')).toBe('my-icon')
  })
  it('replaces @ with hyphen', () => {
    expect(sanitizeFilename('icon@2x.svg')).toBe('icon-2x')
  })
  it('collapses consecutive hyphens', () => {
    expect(sanitizeFilename('arrow--right.svg')).toBe('arrow-right')
  })
  it('trims leading and trailing hyphens', () => {
    expect(sanitizeFilename('-icon-.svg')).toBe('icon')
  })
  it('passes through clean hyphenated names', () => {
    expect(sanitizeFilename('arrow-right.svg')).toBe('arrow-right')
  })
  it('passes through clean simple names', () => {
    expect(sanitizeFilename('home.svg')).toBe('home')
  })
  it('works without .svg extension', () => {
    expect(sanitizeFilename('home')).toBe('home')
  })
})

describe('toPascalCase', () => {
  it('capitalizes a single word', () => {
    expect(toPascalCase('home')).toBe('Home')
  })
  it('capitalizes hyphen-separated words', () => {
    expect(toPascalCase('admin-star')).toBe('AdminStar')
  })
  it('capitalizes three segments', () => {
    expect(toPascalCase('admin-buttons-close')).toBe('AdminButtonsClose')
  })
  it('capitalizes first letter of camelCase (no hyphens)', () => {
    expect(toPascalCase('adminButtons')).toBe('AdminButtons')
  })
  it('handles single-letter segments', () => {
    expect(toPascalCase('a-b')).toBe('AB')
  })
})

describe('deriveCollectionName', () => {
  it('returns "default" for empty segments', () => {
    expect(deriveCollectionName([])).toBe('default')
  })
  it('returns segment as-is for a single simple segment', () => {
    expect(deriveCollectionName(['admin'])).toBe('admin')
  })
  it('camelCases two segments', () => {
    expect(deriveCollectionName(['admin', 'buttons'])).toBe('adminButtons')
  })
  it('camelCases a hyphenated segment', () => {
    expect(deriveCollectionName(['admin-icons'])).toBe('adminIcons')
  })
  it('camelCases two segments where second is hyphenated', () => {
    expect(deriveCollectionName(['ui', 'btn-group'])).toBe('uiBtnGroup')
  })
})

describe('deriveTypeName', () => {
  it('default → DefaultIconName', () => {
    expect(deriveTypeName('default')).toBe('DefaultIconName')
  })
  it('admin → AdminIconName', () => {
    expect(deriveTypeName('admin')).toBe('AdminIconName')
  })
  it('adminButtons → AdminButtonsIconName', () => {
    expect(deriveTypeName('adminButtons')).toBe('AdminButtonsIconName')
  })
})

describe('deriveSpriteComponentName', () => {
  it('default → Sprite', () => {
    expect(deriveSpriteComponentName('default')).toBe('Sprite')
  })
  it('admin → AdminSprite', () => {
    expect(deriveSpriteComponentName('admin')).toBe('AdminSprite')
  })
  it('adminButtons → AdminButtonsSprite', () => {
    expect(deriveSpriteComponentName('adminButtons')).toBe('AdminButtonsSprite')
  })
})

describe('buildIconMeta', () => {
  it('default collection: flat file', () => {
    const meta = buildIconMeta('home.svg', [], '/abs/home.svg', 'Use')
    expect(meta).toEqual({ id: 'home', componentName: 'UseHome', absolutePath: '/abs/home.svg' })
  })

  it('named collection: one level', () => {
    const meta = buildIconMeta('star.svg', ['admin'], '/abs/admin/star.svg', 'Use')
    expect(meta).toEqual({ id: 'admin-star', componentName: 'UseAdminStar', absolutePath: '/abs/admin/star.svg' })
  })

  it('named collection: two levels', () => {
    const meta = buildIconMeta('close.svg', ['admin', 'buttons'], '/abs/admin/buttons/close.svg', 'Use')
    expect(meta).toEqual({
      id: 'admin-buttons-close',
      componentName: 'UseAdminButtonsClose',
      absolutePath: '/abs/admin/buttons/close.svg',
    })
  })

  it('hyphenated filename in named collection', () => {
    const meta = buildIconMeta('arrow-right.svg', ['admin'], '/abs/admin/arrow-right.svg', 'Use')
    expect(meta).toEqual({
      id: 'admin-arrow-right',
      componentName: 'UseAdminArrowRight',
      absolutePath: '/abs/admin/arrow-right.svg',
    })
  })

  it('hyphenated folder segment', () => {
    const meta = buildIconMeta('star.svg', ['admin-icons'], '/abs/admin-icons/star.svg', 'Use')
    expect(meta).toEqual({
      id: 'admin-icons-star',
      componentName: 'UseAdminIconsStar',
      absolutePath: '/abs/admin-icons/star.svg',
    })
  })

  it('filename sanitization: spaces become hyphens', () => {
    const meta = buildIconMeta('My Icon.svg', [], '/abs/My Icon.svg', 'Use')
    expect(meta).toEqual({ id: 'my-icon', componentName: 'UseMyIcon', absolutePath: '/abs/My Icon.svg' })
  })

  it('absolutePath is passed through unchanged', () => {
    const absPath = '/some/deep/path/with spaces/icon.svg'
    const meta = buildIconMeta('icon.svg', [], absPath, 'Use')
    expect(meta.absolutePath).toBe(absPath)
  })

  it('custom component prefix', () => {
    const meta = buildIconMeta('star.svg', ['admin'], '/abs/admin/star.svg', 'Icon')
    expect(meta.componentName).toBe('IconAdminStar')
  })
})
