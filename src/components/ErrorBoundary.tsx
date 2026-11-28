import { Component, type ErrorInfo, type ReactNode } from 'react'
import { BrinelyLogo } from './BrinelyLogo'

type Props = {
  children: ReactNode
  /** A new value clears the error, so moving to another page tries again. */
  resetKey?: string
}

type State = { failed: boolean; resetKey?: string }

/**
 * Catches a screen that crashes while drawing, and shows a plain way out instead of a blank
 * page. The message needs no router or sign-in, so it still works when those are what failed.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { failed: false, resetKey: props.resetKey }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('A screen failed to draw', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <ErrorFallback />
  }
}

export function ErrorFallback() {
  const home = `${import.meta.env.BASE_URL || '/'}#/`
  return (
    <div className="app-shell app-shell-public grid min-h-[100dvh] place-items-center px-6 py-12">
      <div role="alert" className="w-full max-w-md space-y-4 text-center">
        <BrinelyLogo variant="mark" className="mx-auto h-12 w-12 object-contain" title="" />
        <h1 className="text-heading-2 font-semibold text-ink">Something went wrong</h1>
        <p className="text-subtitle text-muted">Please reload the page. If it keeps happening, try again later.</p>
        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
          Reload page
        </button>
        <a href={home} className="text-link inline-flex min-h-12 items-center">
          Go to the home page
        </a>
      </div>
    </div>
  )
}
