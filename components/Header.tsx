import Image from 'next/image'
import Link from 'next/link'
import React from 'react'

const Header = () => {
  return (
    <div className='py-5 flex justify-between items-center'>
        <Image
        src='/Logo.png'
        alt='No Image Found'
        height={80}
        width={160} />
        <div className='space-x-10'> 
            <Link href='/read' className='underline text-gray-500 font-semibold text-md  hover:text-black'>Read Now</Link>
           
        </div>
    </div>
  )
}

export default Header