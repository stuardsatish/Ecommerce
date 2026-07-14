import { assets } from "../../assets/assets"

const MainBanner = ()=> {

    return(
        <div className="w-full">

            <img
                src={assets.banner}
                alt="Banner"
                className="w-full h-screen object-cover"
            />
        </div>
    )

}

export default MainBanner