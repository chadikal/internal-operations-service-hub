import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { AccountRole } from '@prisma/client';
import { Response } from 'express';
import { Public, RecordsActivity } from './auth.decorators';
import { AuthService } from './auth.service';
import {
  AcceptInvitationDto,
  ChangePasswordDto,
  ForgotPasswordDto,
  InviteStaffDto,
  LoginDto,
  OpaqueTokenDto,
  ResetPasswordDto,
  SignupCompanyDto,
  SignupEmailAvailabilityDto,
  UpdateCompanyDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { assertTrustedOrigin } from './origin';
import { AuthenticatedRequest } from './session.guard';
import { clearSessionCookieHeader, sessionCookieHeader } from './session-cookie';

function clientIp(request: AuthenticatedRequest): string {
  return request.ip || request.socket?.remoteAddress || 'unknown';
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertTrustedOrigin(request.header('origin'));
    const result = await this.authService.login(dto.email, dto.password, clientIp(request));
    response.setHeader('Set-Cookie', sessionCookieHeader(result.token));
    return { ...result.account, csrfToken: result.csrfToken };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(request.auth!.sessionId);
    response.setHeader('Set-Cookie', clearSessionCookieHeader());
    return { loggedOut: true };
  }

  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    const auth = request.auth!;
    return {
      id: auth.id,
      name: auth.name,
      email: auth.email,
      companyId: auth.companyId,
      companyName: auth.companyName,
      departmentId: auth.departmentId,
      role: auth.role,
      canHandle: auth.canHandle,
      active: auth.active,
      csrfToken: auth.csrfToken,
    };
  }

  @Patch('me')
  updateProfile(@Req() request: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(request.auth!, dto.name);
  }

  @Post('change-password')
  @HttpCode(200)
  changePassword(@Req() request: AuthenticatedRequest, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(request.auth!, dto);
  }

  @Patch('company')
  updateCompany(@Req() request: AuthenticatedRequest, @Body() dto: UpdateCompanyDto) {
    return this.authService.updateCompany(request.auth!, dto.name);
  }

  @Public()
  @Post('signup')
  signup(@Req() request: AuthenticatedRequest, @Body() dto: SignupCompanyDto) {
    assertTrustedOrigin(request.header('origin'));
    return this.authService.signupCompany(dto);
  }

  @Public()
  @Post('signup/email-availability')
  @HttpCode(200)
  signupEmailAvailability(
    @Req() request: AuthenticatedRequest,
    @Body() dto: SignupEmailAvailabilityDto,
  ) {
    assertTrustedOrigin(request.header('origin'));
    return this.authService.signupEmailAvailability(dto.email, clientIp(request));
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  verifyEmail(@Req() request: AuthenticatedRequest, @Body() dto: OpaqueTokenDto) {
    assertTrustedOrigin(request.header('origin'));
    return this.authService.verifyEmail(dto.token);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Req() request: AuthenticatedRequest, @Body() dto: ForgotPasswordDto) {
    assertTrustedOrigin(request.header('origin'));
    return this.authService.requestPasswordReset(dto.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  resetPassword(@Req() request: AuthenticatedRequest, @Body() dto: ResetPasswordDto) {
    assertTrustedOrigin(request.header('origin'));
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Post('invitations/accept')
  @HttpCode(200)
  acceptInvitation(@Req() request: AuthenticatedRequest, @Body() dto: AcceptInvitationDto) {
    assertTrustedOrigin(request.header('origin'));
    return this.authService.acceptInvitation(dto.token, dto.password);
  }

  @Post('invitations')
  @RecordsActivity()
  invite(@Req() request: AuthenticatedRequest, @Body() dto: InviteStaffDto) {
    return this.authService.inviteStaff(request.auth!, {
      ...dto,
      role: dto.role as AccountRole,
    });
  }
}
