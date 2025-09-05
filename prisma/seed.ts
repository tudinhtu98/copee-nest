import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
const prisma = new PrismaClient()
async function main(){
  const passUser = await bcrypt.hash('password123',10)
  const passAdmin = await bcrypt.hash('password123',10)

  const user = await prisma.user.upsert({
    where:{ email:'user@copee.local' },
    update:{},
    create:{ email:'user@copee.local', username:'user', passwordHash: passUser, role: 'USER' }
  })

  const admin = await prisma.user.upsert({
    where:{ email:'admin@copee.local' },
    update:{},
    create:{ email:'admin@copee.local', username:'admin', passwordHash: passAdmin, role: 'ADMIN' }
  })

  const products = await prisma.product.createMany({
    data: Array.from({length:5}).map((_,i)=>({
      userId: user.id,
      sourceShop:'shopee',
      sourceUrl:'https://shopee.vn/item/'+(1000+i),
      title:'Sản phẩm demo '+(i+1),
      status:'DRAFT'
    }))
  })

  console.log('Seed done', { user: { email: user.email, role: user.role }, admin: { email: admin.email, role: admin.role }, products })
}
main().catch(e=>{ console.error(e); process.exit(1) }).finally(()=> prisma.$disconnect())