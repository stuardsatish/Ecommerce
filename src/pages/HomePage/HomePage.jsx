import Technologies from './Technologies'
import Services from '../../components/Common/Services'
import MainBanner from './MainBanner'
import Testimonials from './Testimonials'
import SocialConnect from './SocialConnect'
import FAQ from './FAQ'
import Explore from './Explore'
import { useSelector } from "react-redux";
import Hero from './Hero'
import About from './About'
import Features from './Features'
import Story from './Story'
import Contact from './Contact'




const HomePage = () => {

  const darkMode = useSelector((state) => state.theme.darkMode);
  // console.log(darkMode);

 
  const user = useSelector((state) => state.user.user)
  // console.log(user.role);

 

  return (
    <>
     
      <Hero />
      <About />
      <Features />
      <Story />
      <Contact />





     
    </>
  )
}

export default HomePage