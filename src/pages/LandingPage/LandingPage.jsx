import React from 'react'
import Hero from './Hero'
import Taste from './Taste'
import Quality from './Quality'
import Parallax from './Parallax'

import SmoothScroll from './SmoothScroll'

const LandingPage = () => {
  return (
    <div className="melt-theme">
      <SmoothScroll>
        <Hero />
        <Taste />
        <Quality />
        <Parallax />

      </SmoothScroll>
    </div>
  )
}

export default LandingPage