import CategoryNewsSection from '@/components/Category'
import Header from '@/components/Header'
import HeroSection from '@/components/Hero'
import PersonalisedFeedSection from '@/components/Personalised'
import SignIn from '@/components/Signin'
import React from 'react'
import DownloadSection from '@/components/Download'

const page = () => {
  return (
    <div>
      <Header />
      <HeroSection />
      <PersonalisedFeedSection/>
      <CategoryNewsSection />
      <SignIn />
      <DownloadSection />
      
    </div>
  )
}

export default page