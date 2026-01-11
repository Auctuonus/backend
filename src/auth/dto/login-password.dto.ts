import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, MinLength } from 'class-validator';

export class LoginPasswordDto {
  @ApiProperty({
    description: 'Telegram ID used as login',
    example: 123456789,
  })
  @IsNumber()
  telegramId: number;

  @ApiProperty({
    description: 'Password (telegram ID as string)',
    example: '123456789',
    minLength: 1,
  })
  @IsString()
  @MinLength(1)
  password: string;
}
