import { Component, type ErrorInfo, type ReactNode } from 'react'
import { report } from '../lib/api'

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    report('boundary', error.message, { stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}` })
  }

  componentDidUpdate(previous: { resetKey?: string }) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page-head not-found" role="alert">
        <p className="eyebrow">Fault · Containment held</p>
        <h1>This station failed to load.</h1>
        <p className="section-lede">
          The error was reported. No transaction was created and nothing was burned. If you were in the middle of a burn, its status is kept on the server and resumes when you reopen the lab.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}
