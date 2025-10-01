import Link from 'next/link'
import React from 'react'

const Header = () => {
  return (
    <div className='py-5 flex justify-between items-center'>
        <div className='text-3xl font-bold border border-gray-200 p-1 rounded-md'>Short News</div>
        <div className='space-x-10'> 
            <Link href='/read' className='underline text-gray-300 font-semibold text-md  hover:text-green-800'>Read Now</Link>
            <Link href='/' className='underline text-gray-300 font-semibold text-md  hover:text-green-800'>Blog</Link>
        </div>
    </div>
  )
}

export default Header