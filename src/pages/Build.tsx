import { IntentList } from '../components/BuildIntents'
import { usePageMeta } from '../lib/meta'
import { Link } from '../router'

export default function Build() {
  usePageMeta({ title: 'Build something', description: 'Tell Quantum Fork what you want to build. It picks the blueprint and configures the cryptography for you.', path: '/build', image: '/api/og?page=build' })
  return (
    <div className="build-page">
      <header className="page-head">
        <p className="eyebrow">Start a build · No code required</p>
        <h1>
          What do you want <span>to build?</span>
        </h1>
        <p className="section-lede">Pick the closest match. You don’t need to know any cryptography; the blueprint chooses it, and Expert Mode is always one click away.</p>
      </header>
      <section className="section section-tight">
        <IntentList />
        <p className="build-foot muted">
          Not sure? <Link to="/blueprints">Compare every blueprint</Link> with its status, or <Link to="/scanner">scan Solana</Link> first to see what a quantum computer would break.
        </p>
      </section>
    </div>
  )
}
