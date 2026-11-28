import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { documentTitle, useDocumentTitle } from './useDocumentTitle'

function Header({ title }: { title: string }) {
  useDocumentTitle(title)
  return null
}

/** A frame and its header both name the tab, as PublicFrame and AppHeader do for signed-in people. */
function Frame({ title }: { title: string }) {
  useDocumentTitle(title)
  return <Header title={title} />
}

afterEach(() => {
  document.title = ''
})

describe('useDocumentTitle', () => {
  it('names the tab after the page and the site', () => {
    expect(documentTitle('Find a court')).toBe('Find a court · bRineLy')
    expect(documentTitle('bRineLy')).toBe('bRineLy')
    expect(documentTitle()).toBe('bRineLy')
  })

  it('puts back the name from before the page opened, even after the title changed', () => {
    document.title = 'Before'
    const view = render(<Frame title="Loading" />)
    expect(document.title).toBe('Loading · bRineLy')
    view.rerender(<Frame title="Rally Point Davao" />)
    expect(document.title).toBe('Rally Point Davao · bRineLy')
    view.unmount()
    expect(document.title).toBe('Before')
  })
})
