import { Outlet } from 'react-router-dom'
import { Nav } from './Nav'
import { Footer } from './Footer'
import { Cursor } from './Cursor'

export function Layout() {
  return (
    <>
      <Cursor />
      <div className="page">
        <Nav />
        <Outlet />
        <Footer />
      </div>
    </>
  )
}
