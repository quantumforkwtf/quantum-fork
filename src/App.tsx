import { lazy, Suspense, useEffect } from 'react'
import { BuildDialog } from './components/BuildIntents'
import { Footer, Nav, Toaster } from './components/Chrome'
import ErrorBoundary from './components/ErrorBoundary'
import { Tutorial } from './components/Tutorial'
import { usePageMeta } from './lib/meta'
import { isNetworkTab } from './lib/networkUi'
import { navigate, useLocation } from './navigation'
import Home from './pages/Home'
import { Link } from './router'

const Scanner = lazy(() => import('./pages/Scanner'))
const Lab = lazy(() => import('./pages/Lab'))
const Species = lazy(() => import('./pages/Species'))
const Report = lazy(() => import('./pages/Report'))
const QFork = lazy(() => import('./pages/QFork'))
const Receipt = lazy(() => import('./pages/Receipt'))
const Security = lazy(() => import('./pages/Security'))
const Blueprints = lazy(() => import('./pages/Blueprints'))
const BlueprintDetail = lazy(() => import('./pages/BlueprintDetail'))
const Build = lazy(() => import('./pages/Build'))
const AppScan = lazy(() => import('./pages/AppScan'))
const Networks = lazy(() => import('./pages/Networks'))
const NetworkConsole = lazy(() => import('./pages/Network'))
const Create = lazy(() => import('./pages/Create'))
const RealityFork = lazy(() => import('./pages/RealityFork'))
const TimeMachine = lazy(() => import('./pages/TimeMachine'))
const ForkWars = lazy(() => import('./pages/ForkWars'))
const GhostChains = lazy(() => import('./pages/GhostChains'))
const Mutation = lazy(() => import('./pages/Mutation'))
const QuantumShield = lazy(() => import('./pages/QuantumShield'))
const Explore = lazy(() => import('./pages/Explore'))
const ExploreDetail = lazy(() => import('./pages/Explore').then((module) => ({ default: module.ExploreDetail })))
const Accounts = lazy(() => import('./pages/Account'))
const AccountConsole = lazy(() => import('./pages/Account').then((module) => ({ default: module.AccountConsole })))

const REDIRECTS: Record<string, string> = { '/token': '/qfork', '/scan': '/quantumize' }

function NotFound() {
  usePageMeta({ title: 'Not found', path: '/404' })
  return (
    <div className="page-head not-found">
      <p className="eyebrow">Error 404 · Containment breach</p>
      <h1>Nothing lives here.</h1>
      <p className="section-lede">This corridor of the lab has not been built yet.</p>
      <Link to="/" className="btn btn-primary">
        Return to the reactor
      </Link>
    </div>
  )
}

function Route() {
  const { path } = useLocation()
  const redirect = REDIRECTS[path.replace(/\/$/, '')]
  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true })
  }, [redirect])
  if (redirect) return null

  if (path === '/') return <Home />
  if (path === '/scanner') return <Scanner />
  if (path === '/lab') return <Lab />
  if (path === '/lab/reality-fork') return <RealityFork />
  if (path === '/lab/time-machine') return <TimeMachine />
  if (path === '/lab/fork-wars') return <ForkWars />
  if (path === '/lab/ghost-chains') return <GhostChains />
  if (path === '/lab/mutation') return <Mutation />
  if (path === '/lab/quantum-shield') return <QuantumShield />
  if (path === '/create') return <Create />
  if (path === '/explore') return <Explore />
  const explored = path.match(/^\/explore\/(0x[0-9a-f]{64})\/?$/)
  if (explored) return <ExploreDetail hash={explored[1]} />
  if (path === '/account' || path === '/account/') return <Accounts />
  const account = path.match(/^\/account\/(0x[0-9a-fA-F]{40})\/?$/)
  if (account) return <AccountConsole key={account[1].toLowerCase()} address={account[1] as `0x${string}`} />
  if (path === '/species' || path === '/species/') return <Species />
  if (path === '/qfork') return <QFork />
  if (path === '/security') return <Security />
  if (path === '/blueprints' || path === '/blueprints/') return <Blueprints />
  if (path === '/build') return <Build />
  if (path === '/quantumize') return <AppScan />
  const blueprint = path.match(/^\/blueprints\/([a-z0-9-]{1,48})\/?$/)
  if (blueprint) return <BlueprintDetail key={blueprint[1]} slug={blueprint[1]} />
  const species = path.match(/^\/species\/([a-z0-9_-]+)\/?$/)
  if (species) return <Report key={species[1]} id={species[1]} />
  if (path === '/network' || path === '/network/') return <Networks />
  const network = path.match(/^\/network\/([a-z0-9_-]+)(?:\/([a-z]+))?\/?$/)
  if (network) {
    const tab = network[2] === 'assets' ? 'tokens' : (network[2] ?? 'overview')
    return <NetworkConsole key={network[1]} id={network[1]} tab={isNetworkTab(tab) ? tab : 'overview'} />
  }
  const burn = path.match(/^\/burn\/([A-Za-z0-9-]{8,100})\/?$/)
  if (burn) return <Receipt key={burn[1]} id={burn[1]} />
  return <NotFound />
}

export default function App() {
  const { path } = useLocation()
  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <ErrorBoundary resetKey={path}>
          <Suspense fallback={<div className="page-loading" aria-busy="true" aria-label="Loading" />}>
            <Route />
          </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
      <Toaster />
      <Tutorial />
      <BuildDialog />
    </div>
  )
}
