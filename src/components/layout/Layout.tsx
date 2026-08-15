import { Outlet } from 'react-router-dom'
import { Nav } from './Nav'
import { Footer } from './Footer'
import { Cursor } from './Cursor'
import { FontLoadBar } from '../FontLoadBar'

export function Layout() {
  return (
    <>
      <FontLoadBar />
      <Cursor />
      <div className="page">
        <Nav />
        <Outlet />
        <Footer />
      </div>
    </>
  )
}
